// rsi_low_turn v4 接入核验（只读本地数据，不联网、不写库）
// 用途：检查「快照粗筛 + 量能分门槛」对 v4 命中票的拦截情况，确认接入后选股链路是否真的可用。
// 用法：node tools/verify_rsi_low_turn_v4.js [快照日期]
const fs = require('fs');
const path = require('path');
const { readKline } = require('../storage');
const { matchKlinePattern, matchPrefilter, volumeProfile, AUTO_POOL_MIN_SCORE } = require('../screener-core');
const { load: loadRules } = require('../rules-store');

const snapshotDate = process.argv[2] || '2026-09-14';
const SNAPSHOT_DIR = path.join(__dirname, '..', 'data', 'snapshots');
// 参数取当前规则库（与线上选股同一来源），不再写死阈值。
const RSI_RULE = (loadRules() || []).find((r) => r.id === 'rsi_low_turn') || {};
const V4_PARAMS = { period: 14, low: 18, drop_days: 60, drop_max: -30, ...(RSI_RULE.params || {}) };
const V4_PREFILTER = { minChangePct: -9, maxChangePct: 7 };

function loadSnapshot(date) {
  const rows = [];
  for (const file of fs.readdirSync(SNAPSHOT_DIR)) {
    if (!file.startsWith(date + '__') || !file.endsWith('.json')) continue;
    const data = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, file), 'utf8'));
    for (const r of data.records || []) rows.push({ ...r, snapshotFile: file });
  }
  return rows;
}

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 100) / 100;
};

async function main() {
  const rows = loadSnapshot(snapshotDate);
  const hits = [];
  let withKline = 0;
  let sampleShort = 0;

  for (const row of rows) {
    const rec = await readKline(row.code);
    const kline = rec && Array.isArray(rec.kline) ? rec.kline : [];
    if (!kline.length) continue;
    withKline += 1;
    if (kline.length < 61) { sampleShort += 1; continue; }
    const res = matchKlinePattern('rsi_low_turn', kline, { ...V4_PARAMS, code: row.code });
    if (!res.matched) continue;
    const profile = volumeProfile(row);
    hits.push({
      code: row.code,
      name: row.name,
      changePct: row.changePct,
      score: profile.score,
      prefilterPass: matchPrefilter({ prefilter: V4_PREFILTER }, profile),
      reason: res.reason,
      klineTail: kline[kline.length - 1].date,
    });
  }

  const scores = hits.map((h) => h.score);
  const summary = {
    snapshotDate,
    snapshotRows: rows.length,
    localKlineRows: withKline,
    sampleShortRows: sampleShort,
    v4Hits: hits.length,
    v4HitsPassPrefilter: hits.filter((h) => h.prefilterPass).length,
    v4HitsPassVolumeGate: hits.filter((h) => h.score >= AUTO_POOL_MIN_SCORE).length,
    autoPoolMinScore: AUTO_POOL_MIN_SCORE,
    hitScore: { min: scores.length ? Math.min(...scores) : null, median: median(scores), max: scores.length ? Math.max(...scores) : null },
    hits,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
