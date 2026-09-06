// 量能洞察 · 测试辅助：生成 N 个唯一的连续交易日（保证 SQLite 主键(code,date)不产生合并）。
function uniqueDates(n, startISO = '2026-01-01') {
  const out = [];
  const d = new Date(startISO + 'T00:00:00Z');
  for (let i = 0; i < n; i += 1) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

module.exports = { uniqueDates };
