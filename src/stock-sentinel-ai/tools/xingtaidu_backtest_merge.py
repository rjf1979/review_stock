# -*- coding: utf-8 -*-
"""合并 parts/*.csv 为整体明细，并输出统计 JSON（工具函数复用回测模块，保证口径一致）。"""
import csv, glob, json, os, sys
from collections import Counter, defaultdict
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import xingtaidu_backtest as xt

FLOAT = {"buy_price","sell_price","gross_pct","cost_pct","net_pct","initial_stop",
         "first_target","measured_target","key_level","structure_low"}
INT = {"hold_days"}

def load(pattern_glob):
    rows = []
    for p in sorted(glob.glob(pattern_glob)):
        with open(p, encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                t = {}
                for k, v in r.items():
                    if k in FLOAT:
                        t[k] = None if v in (None, "", "None") else float(v)
                    elif k in INT:
                        t[k] = int(float(v))
                    elif k == "partial_exit":
                        t[k] = (v == "True")
                    else:
                        t[k] = v
                rows.append(t)
    return rows

def extra(trades):
    by = defaultdict(list)
    for t in trades: by[t["pattern"]].append(t)
    out = {}
    for pid, xs in sorted(by.items()):
        v = np.array([x["net_pct"] for x in xs], dtype=float)
        w = v[v > 0]; ls = v[v < 0]
        reasons = Counter(x["reason"] for x in xs)
        years = defaultdict(list)
        for x in xs: years[x["buy_date"][:4]].append(x["net_pct"])
        out[pid] = {
            "n": len(xs),
            "avg_win": round(float(w.mean()), 4) if len(w) else None,
            "avg_loss": round(float(ls.mean()), 4) if len(ls) else None,
            "payoff": round(float(w.mean() / abs(ls.mean())), 4) if len(w) and len(ls) else None,
            "expectancy": round(float(v.mean()), 4),
            "win_rate": round(float((v > 0).mean() * 100), 2),
            "profit_factor": round(float(w.sum() / abs(ls.sum())), 4) if len(w) and len(ls) else None,
            "std": round(float(v.std(ddof=1)), 4) if len(v) > 1 else None,
            "median": round(float(np.median(v)), 4),
            "p10": round(float(np.percentile(v, 10)), 4),
            "max_win": round(float(v.max()), 4), "max_loss": round(float(v.min()), 4),
            "partial_rate": round(float(np.mean([x["partial_exit"] for x in xs]) * 100), 2),
            "avg_hold": round(float(np.mean([x["hold_days"] for x in xs])), 2),
            "reasons": {k: round(v2 / len(xs) * 100, 2) for k, v2 in reasons.most_common()},
            "by_year": {y: _slice_stats(z) for y, z in sorted(years.items())},
        }
    return out


def _slice_stats(vals):
    """一段收益样本的交易数/胜率/期望/盈亏比/盈利因子。"""
    z = np.asarray(vals, dtype=float)
    w = z[z > 0]; ls = z[z < 0]
    return {
        "n": int(len(z)),
        "avg": round(float(z.mean()), 4),
        "win": round(float((z > 0).mean() * 100), 2),
        "payoff": round(float(w.mean() / abs(ls.mean())), 4) if len(w) and len(ls) else None,
        "pf": round(float(w.sum() / abs(ls.sum())), 4) if len(w) and len(ls) else None,
    }


def periods(trades, splits):
    by = defaultdict(list)
    for t in trades: by[t["pattern"]].append(t)
    out = {}
    for name, (a, b) in splits.items():
        d = {}
        for pid, xs in sorted(by.items()):
            z = [x["net_pct"] for x in xs if a <= x["buy_date"] <= b]
            if not z: continue
            d[pid] = _slice_stats(z)
        out[name] = d
    return out

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--glob", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--outdir", default=xt.OUT_DIR)
    a = ap.parse_args()
    trades = load(a.glob)
    summary = xt.summarize(trades)
    base = os.path.join(a.outdir, a.out)
    os.makedirs(a.outdir, exist_ok=True)
    xt.write_csv(trades, base + ".csv")
    with open(base + ".json", "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "extra": extra(trades),
                   "periods": periods(trades, {"P2021_2023": ("2021-01-01", "2023-12-31"),
                                               "P2024_2026": ("2024-01-01", "2026-12-31")})},
                  f, ensure_ascii=False, indent=2)
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk in ("n","win_rate","avg_pct","median_pct","profit_factor","avg_hold_days")}
                      for k, v in summary["by_pattern"].items()}, ensure_ascii=False, indent=1))
    print("TOTAL", {k: summary[k] for k in ("total","win_rate","avg_pct","median_pct","profit_factor")})
