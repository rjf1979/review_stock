# -*- coding: utf-8 -*-
"""给 minute-reverse-v1 模型补上自包含底座：``metas``（分档边界/标签）+ ``ruleSet`` + ``modelIdentity``。

为什么必须补
------------
``tools/minute_reverse_analyze.py`` 拟合时在内存里算出了 ``metas``（数值特征按
训练集分位数切 10 档的边界 ``edges``），但写 ``reverse_model.json`` 的 ``model``
块时把它丢了，只留下 ``tables[*][key]['buckets']`` 的**分档标签字符串**。

而标签是经过 ``bt_decision_engine._fmt_num`` 四舍五入的（真实边界 0.0945 → 标签
``0.095``），用它反推边界会给实盘样本错位分档。所以实盘打分必须先有 ``metas``。

同理，``rules.singles/pairs/triples`` 是分析脚本内部的临时结构（带 ``q`` 分位点、
逐日/逐月稳健性统计），实盘要复现「规则命中」还需要显式约定「值必须有限、缺失不算
命中」。这里把它归一化成 ``model['ruleSet']``：条件只保留 ``key/op/v``，统计量只保留
实盘展示需要的字段，规则集成为模型块的一部分，实盘脚本不需要再读分析脚本的中间产物。

做法
----
用**同一条代码路径**（``bt_decision_engine.prepare_codes``，BINS=10 的训练集分位
边界）在 ``samples.csv`` 上重算 ``metas``；逐特征、逐档核对「重算出来的档位数 /
每档样本数」与模型文件里的 ``buckets`` 完全一致后，才把 ``metas`` 与
``modelIdentity``（runId/runKey/样本区间/行数）原子写回模型文件。

用法::

    python tools/reverse_model_finalize.py --dry-run    # 只核对，不写盘
    python tools/reverse_model_finalize.py              # 核对 + 写盘
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bt_decision_engine as eng  # noqa: E402
from minute_reverse_analyze import (ENG_FEATURES, FEATURE_CN, FEATURE_KEYS,  # noqa: E402
                                    FEATURE_UNIT)
from minute_reverse_backtest import OUT_DIR  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, '..'))
BT_DB = os.path.join(ROOT, 'data', 'backtest.db')
DEFAULT_SAMPLES = os.path.join(OUT_DIR, 'samples.csv')
DEFAULT_MODEL = os.path.join(OUT_DIR, 'reverse_model.json')

MODEL_VERSION = 'minute-reverse-v1'

# 规则集：分析脚本里的层级名 → 条件个数（对应字段 a / b / c）
RULE_LEVELS = (('singles', 1, 'single'), ('pairs', 2, 'pair'), ('triples', 3, 'triple'))
RULE_STAT_FIELDS = ('n', 'hitPct', 'lift', 'robust', 'dayCount', 'dayLiftMin',
                    'dayLiftMed', 'monthCount', 'monthLiftMin', 'monthLiftMed')


def log(msg: str) -> None:
    print(msg, flush=True)


def load_json(path: str) -> dict:
    with open(path, 'r', encoding='utf-8') as fp:
        return json.load(fp)


def save_json_atomic(path: str, obj: dict) -> None:
    tmp = path + '.writing'
    with open(tmp, 'w', encoding='utf-8') as fp:
        json.dump(obj, fp, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def run_identity(db: str = BT_DB) -> dict:
    """从 bt_run 里找 minute-reverse 批次的 runId/runKey（找不到就留空）。"""
    if not os.path.exists(db):
        return {}
    conn = sqlite3.connect('file:%s?mode=ro' % db.replace('\\', '/'), uri=True)
    try:
        row = conn.execute(
            "SELECT runId, runKey, createdAt, tradeCount, note FROM bt_run "
            "WHERE runKey LIKE 'reverse-%' ORDER BY runId DESC LIMIT 1").fetchone()
    finally:
        conn.close()
    if not row:
        return {}
    return {'runId': int(row[0]), 'runKey': str(row[1]),
            'runCreatedAt': str(row[2]), 'runTradeCount': int(row[3] or 0),
            'runNote': (row[4] or '')[:200]}


def recompute_metas(samples: str, keys: list):
    """在 samples.csv 上重算分档边界（与训练时同一函数、同一参数）。"""
    cols = ['code', 'date'] + keys
    df = pd.read_csv(samples, usecols=lambda c: c in set(cols), low_memory=False)
    missing = [k for k in keys if k not in df.columns]
    if missing:
        raise SystemExit('[fail] samples.csv 缺列：%s' % missing)
    eng.FEATURES = ENG_FEATURES
    eng.BINS = eng.BINS          # 显式声明：分档数必须与训练一致（默认 10）
    codes, metas = eng.prepare_codes(df, keys)
    return df, codes, metas


def verify(model: dict, codes: dict, metas: dict, keys: list, samples: str) -> int:
    """逐特征、逐档把重算结果与模型文件核对；返回问题数。"""
    model_block = model.get('model') or {}
    tables = model_block.get('tables') or {}
    weights = model_block.get('weights') or {}
    mu = model_block.get('mu') or {}
    sd = model_block.get('sd') or {}
    feats = model_block.get('features') or []
    feats_keys = [f.get('key') for f in feats]
    bad = 0

    log('[chk] 模型特征数 %d / 重算键数 %d' % (len(feats_keys), len(keys)))
    if feats_keys != list(keys):
        log('  [fail] 模型 features[] 与 FEATURES 顺序不一致')
        log('        模型 %s' % feats_keys)
        log('        代码 %s' % list(keys))
        bad += 1
    for t in eng.target_keys():
        n_w = len(weights.get(t) or [])
        n_mu = len(mu.get(t) or [])
        n_sd = len(sd.get(t) or [])
        # 打分链路：w = [截距] + 58 系数；mu/sd 只对 58 个特征做标准化
        if not (n_w == len(keys) + 1 and n_mu == n_sd == len(keys)):
            log('  [fail] %s 参数长度 w=%d mu=%d sd=%d（应为 w=%d, mu=sd=%d）'
                % (t, n_w, n_mu, n_sd, len(keys) + 1, len(keys)))
            bad += 1

    header = '%-20s %5s %6s %8s  %s' % ('feature', 'kind', 'bins', 'n', 'bucket-n 校验')
    log('[chk] ' + header)
    for key in keys:
        _c, u = codes[key]
        cnt = np.bincount(_c, minlength=len(u))
        observed = {str(name): int(cnt[i]) for i, name in enumerate(u)}
        meta = metas[key]
        for t in eng.target_keys():
            buckets = ((tables.get(t) or {}).get(key) or {}).get('buckets') or {}
            got = {str(k): int(v['n']) for k, v in buckets.items()}
            if set(got) != set(observed):
                log('  [fail] %s / %s 档位集合不一致：模型 %d 档 vs 重算 %d 档'
                    % (key, t, len(got), len(observed)))
                bad += 1
                continue
            diff = {k: (observed[k], got[k]) for k in observed if observed[k] != got[k]}
            if diff:
                log('  [fail] %s / %s 档位样本数不一致：%s' % (key, t, list(diff.items())[:4]))
                bad += 1
        n_tot = int(sum(observed.values()))
        bins = len(meta.get('edges') or []) + 1 if meta.get('kind') == 'num' else len(observed)
        log('  %-20s %5s %6d %8d  ok(%d 档)'
            % (key, meta.get('kind'), bins, n_tot, len(observed)))
    return bad


def build_rule_set(block: dict) -> dict:
    """把 ``rules.singles/pairs/triples`` 归一化成实盘可直接复现的 ``ruleSet``。

    实盘复现口径（与分析脚本 ``cand_mask`` 一致）：条件命中 = 特征值**有限**（非缺失）
    且按 ``op`` 与 ``v`` 比较成立；任一条件不成立则整条规则不命中。
    """
    rules = []
    for level_name, n_cond, tag_name in RULE_LEVELS:
        for r in (block.get(level_name) or []):
            conds = []
            for tag in ('a', 'b', 'c')[:n_cond]:
                e = r.get(tag)
                if not e:
                    continue
                key = str(e.get('key'))
                if key not in FEATURE_CN:
                    raise SystemExit('[fail] 规则引用了未知特征：%s' % key)
                conds.append({'key': key, 'cn': FEATURE_CN[key],
                              'op': str(e.get('op')), 'v': float(e.get('v')),
                              'unit': FEATURE_UNIT.get(key, '')})
            if len(conds) != n_cond:
                raise SystemExit('[fail] %s 规则条件数 %d ≠ %d：%s'
                                 % (level_name, len(conds), n_cond, r.get('text')))
            rules.append({
                'level': n_cond, 'levelName': tag_name,
                'conds': conds,
                'text': str(r.get('text') or ''),
                'stat': {k: r[k] for k in RULE_STAT_FIELDS if k in r},
            })
    return {
        'nCandidates': int(block.get('nCandidates') or 0),
        'note': ('条件阈值为训练集分位点；命中要求特征值有限（缺失不算命中）；'
                 'stat.lift 为整体命中率 / 样本基准，dayLiftMed 为逐日中位 lift'),
        'rules': rules,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--samples', default=DEFAULT_SAMPLES)
    ap.add_argument('--model', default=DEFAULT_MODEL)
    ap.add_argument('--db', default=BT_DB)
    ap.add_argument('--dry-run', action='store_true', help='只核对，不写盘')
    args = ap.parse_args(argv)

    t0 = time.time()
    model = load_json(args.model)
    if model.get('version') != MODEL_VERSION:
        log('[fail] 模型版本 %r ≠ %r' % (model.get('version'), MODEL_VERSION))
        return 1
    keys = list(FEATURE_KEYS)
    log('[in] %s（%d 字节）/ %s' % (os.path.basename(args.model),
                                    os.path.getsize(args.model),
                                    os.path.basename(args.samples)))
    df, codes, metas = recompute_metas(args.samples, keys)
    log('[ok] 重算分档：%d 行 / %d 只 / %d 个交易日，用时 %.0fs'
        % (len(df), df['code'].nunique(), df['date'].nunique(), time.time() - t0))

    bad = verify(model, codes, metas, keys, args.samples)
    if bad:
        log('[fail] 核对未通过：%d 处不一致 —— 不写盘' % bad)
        return 1
    log('[ok] 全部 %d 个特征 × %d 个目标的分档与样本数逐档一致'
        % (len(keys), len(eng.target_keys())))

    rule_set = build_rule_set(model.get('rules') or {})
    n_rules = len(rule_set['rules'])
    if not n_rules:
        log('[fail] 模型缺少 rules（singles/pairs/triples 均为空）—— 不写盘')
        return 1
    by_level = {tag: sum(1 for r in rule_set['rules'] if r['levelName'] == tag)
                for _ln, _n, tag in RULE_LEVELS}
    log('[ok] 规则集归一化：%d 条（%s）/ 候选条件 %d 个'
        % (n_rules, '/'.join('%s %d' % (k, v) for k, v in by_level.items()),
           rule_set['nCandidates']))

    ident = run_identity(args.db)
    ident.update({
        'version': MODEL_VERSION,
        'finalizedAt': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'samplesFile': os.path.relpath(args.samples, ROOT).replace('\\', '/'),
        'rows': int(len(df)),
        'codes': int(df['code'].nunique()),
        'dateRange': [int(df['date'].min()), int(df['date'].max())],
        'featureCount': len(keys),
        'bins': int(eng.BINS),
        'ruleCount': n_rules,
        'tokenizer': 'bt_decision_engine.prepare_codes（训练集分位数边界）',
    })
    if args.dry_run:
        log('[dry] 不写盘；将写入 modelIdentity=%s' % json.dumps(ident, ensure_ascii=False))
        log('[dry] 将写入 model.ruleSet：%d 条规则，示例 %s'
            % (n_rules, rule_set['rules'][0]['text']))
        return 0

    model['modelIdentity'] = ident
    model.setdefault('model', {})['metas'] = {
        k: {'kind': metas[k].get('kind'),
            'edges': [float(e) for e in (metas[k].get('edges') or [])],
            'labels': list(metas[k].get('labels') or [])}
        for k in keys}
    model['model']['ruleSet'] = rule_set
    save_json_atomic(args.model, model)
    log('[out] %s：已写入 modelIdentity + metas（%d 个特征）+ ruleSet（%d 条规则）'
        % (args.model, len(model['model']['metas']), n_rules))
    log('[done] 用时 %.0fs' % (time.time() - t0))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
