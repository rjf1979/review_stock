'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { claimSlotAndWrite, updateHeadAndWrite } = require('./claim');

function fakeDb() {
  const slots = new Map();
  const heads = new Map();
  return {
    async tryClaim(slotKey, deviceId) {
      if (slots.has(slotKey)) return false;
      slots.set(slotKey, { claimed_by: deviceId });
      return true;
    },
    async completeSlot(slotKey, objectKey, etag) {
      const s = slots.get(slotKey) || {};
      s.object_key = objectKey; s.etag = etag;
      slots.set(slotKey, s);
    },
    async getSlot(slotKey) {
      const s = slots.get(slotKey);
      return s && s.object_key ? { object_key: s.object_key, etag: s.etag, device_id: s.claimed_by } : null;
    },
    async updateHead(stream, objectKey, updatedAt, deviceId) {
      const cur = heads.get(stream);
      if (cur && cur.updated_at && cur.updated_at >= updatedAt) return false;
      heads.set(stream, { object_key: objectKey, updated_at: updatedAt, device_id: deviceId });
      return true;
    },
  };
}

function fakeOss() {
  const objects = new Map();
  return {
    async putPublic(key, body) { objects.set(key, body); return { url: `https://cdn/${key}`, etag: 'etag-' + key }; },
    url(key) { return `https://cdn/${key}`; },
  };
}

test('槽位认领：并发两写入者恰好一个获胜', async () => {
  const db = fakeDb();
  const oss = fakeOss();
  const args = { db, oss, slotKey: 'review:2026-08-29:close', objectKey: 'hangqing/review/20260829/close.json', data: { date: '2026-08-29' } };
  const [a, b] = await Promise.all([
    claimSlotAndWrite({ ...args, deviceId: 'dev_A' }),
    claimSlotAndWrite({ ...args, deviceId: 'dev_B' }),
  ]);
  const winners = [a, b].filter((r) => r.won);
  assert.equal(winners.length, 1);
  const loser = [a, b].find((r) => !r.won);
  // 落败方 url 始终可派生，即使获胜方尚未写完
  assert.ok(loser.url.includes('/hangqing/review/20260829/close.json'));
});

test('槽位认领：先到先得，后来者读到已有对象', async () => {
  const db = fakeDb();
  const oss = fakeOss();
  const args = { db, oss, slotKey: 'dragon:2026-08-29', objectKey: 'hangqing/dragon/20260829.json', data: { date: '2026-08-29', list: [] } };
  const first = await claimSlotAndWrite({ ...args, deviceId: 'dev_A' });
  const second = await claimSlotAndWrite({ ...args, deviceId: 'dev_B' });
  assert.equal(first.won, true);
  assert.equal(second.won, false);
  assert.equal(second.deviceId, 'dev_A');
  assert.equal(second.ready, true);
  assert.equal(second.etag, 'etag-hangqing/dragon/20260829.json');
});

test('头指针更新：单调守卫拒绝旧时间戳', async () => {
  const db = fakeDb();
  const oss = fakeOss();
  const base = { db, oss, stream: 'realtime', deviceId: 'dev_A', data: { updatedAt: 'x' } };
  const newer = await updateHeadAndWrite({ ...base, objectKey: 'hangqing/realtime/1.json', updatedAt: '2026-08-29T02:00:00Z' });
  const older = await updateHeadAndWrite({ ...base, objectKey: 'hangqing/realtime/2.json', updatedAt: '2026-08-29T01:00:00Z' });
  assert.equal(newer.accepted, true);
  assert.equal(older.accepted, false);
  assert.equal(older.stale, true);
});
