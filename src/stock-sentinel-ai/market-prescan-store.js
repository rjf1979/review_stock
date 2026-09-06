const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./storage');

const PRESCAN_FILE = path.join(DATA_DIR, 'market-prescan.json');

function shanghaiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).reduce((out, part) => { out[part.type] = part.value; return out; }, {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function isClosedMarketTime(now = new Date()) {
  const clock = shanghaiClock(now);
  return clock.weekday === 'Sat' || clock.weekday === 'Sun' || clock.minutes >= 15 * 60;
}

function canReuseClosedPrescan(record, now = new Date()) {
  if (!record || !record.isFinal || !record.asOf) return false;
  const clock = shanghaiClock(now);
  if (clock.weekday === 'Sat' || clock.weekday === 'Sun' || clock.minutes < 9 * 60 + 15) return true;
  return clock.minutes >= 15 * 60 && record.asOf === clock.date;
}

function readPrescan() {
  try { return JSON.parse(fs.readFileSync(PRESCAN_FILE, 'utf8')); } catch { return null; }
}

function writePrescan(record) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${PRESCAN_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(record, null, 2), 'utf8');
  fs.renameSync(temp, PRESCAN_FILE);
  return record;
}

module.exports = { PRESCAN_FILE, shanghaiClock, isClosedMarketTime, canReuseClosedPrescan, readPrescan, writePrescan };
