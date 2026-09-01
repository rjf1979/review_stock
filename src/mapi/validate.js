'use strict';
// 写入校验：schema / 合理性（时间、交易日）。纯函数、可注入 now/today，便于单测。
// 注：交易日仅按工作日(周一~五)判断，不含节假日日历（与 PC 端一致，见 desktop/server.js getMarketSession）。

const { canonicalMode } = require('./keys');

function ok() { return { ok: true }; }
function fail(error) { return { ok: false, error }; }

function validDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')); }

function shanghaiDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(value);
}

function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sun .. 6=Sat
}
function isWeekend(dateStr) {
  const w = weekdayOf(dateStr);
  return w === 0 || w === 6;
}

function previousWeekdayISO(dateStr) {
  if (!validDate(dateStr)) return null;
  const date = new Date(`${dateStr}T00:00:00Z`);
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10);
}
// ISO 日期串按字典序比较即可判断先后。
function isFutureDate(dateStr, today = shanghaiDate()) {
  return validDate(dateStr) && String(dateStr) > today;
}

function parseTime(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}
function isFutureTime(iso, now = Date.now(), skewMs = 5 * 60 * 1000) {
  const t = parseTime(iso);
  return t != null && t > now + skewMs;
}

function checkDate(date, opts = {}) {
  if (!validDate(date)) return fail('date 格式应为 YYYY-MM-DD');
  if (isFutureDate(date, opts.today)) return fail('date 不能晚于今天');
  if (opts.tradeDay !== false && isWeekend(date)) return fail('date 为周末休市日');
  return ok();
}

function validateReview(body = {}, opts = {}) {
  const date = body.date || body.meta?.trade_date;
  const d = checkDate(date, opts);
  if (!d.ok) return d;
  const mode = body.meta?.report_mode || body.mode || 'close';
  canonicalMode(mode); // 非法值也会被归一化，不额外拒绝
  if (body.markdown == null && body.payload == null) return fail('复盘缺少内容(markdown/payload)');
  return ok();
}

function validateDragon(body = {}, opts = {}) {
  const d = checkDate(body.date, opts);
  if (!d.ok) return d;
  if (!Array.isArray(body.list)) return fail('龙虎榜缺少 list');
  return ok();
}

function validateKline(body = {}, opts = {}) {
  if (!body.code) return fail('缺少 code');
  if (!Array.isArray(body.kline)) return fail('缺少 kline');
  const d = body.tradeDate || body.latestDate;
  if (d) {
    const c = checkDate(d, opts);
    if (!c.ok) return c;
  }
  return ok();
}

function validateRealtime(body = {}, opts = {}) {
  if (!body.updatedAt) return fail('缺少 updatedAt');
  if (isFutureTime(body.updatedAt, opts.now)) return fail('updatedAt 不能来自未来');
  return ok();
}

function validateQuotes(body = {}, opts = {}) {
  if (!Array.isArray(body.stocks)) return fail('缺少 stocks');
  if (!body.updatedAt) return fail('缺少 updatedAt');
  if (isFutureTime(body.updatedAt, opts.now)) return fail('updatedAt 不能来自未来');
  for (const s of body.stocks) {
    if (s && typeof s === 'object' && typeof s.price === 'number' && s.price < 0) return fail('报价价格不能为负');
  }
  return ok();
}

module.exports = {
  validDate, shanghaiDate, weekdayOf, isWeekend, previousWeekdayISO, isFutureDate, isFutureTime,
  validateReview, validateDragon, validateKline, validateRealtime, validateQuotes,
};
