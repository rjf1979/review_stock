'use strict';
// PG 封装：devices / slots / heads 三表 + 原子认领 + 单调头指针。依赖 pg（云模式才需要）。
// 原子性由 PG 唯一约束 / ON CONFLICT 提供，是「先采集先共享」的仲裁基石。

function createDb(cfg) {
  let Pool;
  try { Pool = require('pg').Pool; } catch { throw new Error('缺少依赖 pg，请先 npm install'); }
  const pool = new Pool(cfg);
  const q = (text, params) => pool.query(text, params);

  async function ensureSchema() {
    await q(`CREATE TABLE IF NOT EXISTS devices (
      device_id  TEXT PRIMARY KEY,
      trust_level INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await q(`CREATE TABLE IF NOT EXISTS slots (
      slot_key   TEXT PRIMARY KEY,
      status     TEXT NOT NULL DEFAULT 'claimed',
      device_id  TEXT NOT NULL,
      object_key TEXT,
      etag       TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      done_at    TIMESTAMPTZ
    )`);
    await q(`CREATE INDEX IF NOT EXISTS slots_done_idx ON slots (status, slot_key)`);
    await q(`CREATE TABLE IF NOT EXISTS heads (
      stream     TEXT PRIMARY KEY,
      object_key TEXT,
      updated_at TIMESTAMPTZ,
      device_id  TEXT
    )`);
  }

  // 原子认领：唯一约束冲突时 rowCount=0 → 已有写入者。
  async function tryClaim(slotKey, deviceId) {
    const r = await q(
      `INSERT INTO slots (slot_key, device_id) VALUES ($1, $2)
       ON CONFLICT (slot_key) DO NOTHING RETURNING slot_key`,
      [slotKey, deviceId],
    );
    return r.rowCount > 0;
  }

  async function completeSlot(slotKey, objectKey, etag) {
    await q(
      `UPDATE slots SET status='done', object_key=$2, etag=$3, done_at=now() WHERE slot_key=$1`,
      [slotKey, objectKey, etag],
    );
  }

  async function getSlot(slotKey) {
    const r = await q(
      `SELECT slot_key, status, device_id, object_key, etag FROM slots WHERE slot_key=$1`,
      [slotKey],
    );
    return r.rows[0] || null;
  }

  async function listSlots(prefix, limit = 200) {
    const r = await q(
      `SELECT slot_key, status, device_id, object_key, etag, done_at
       FROM slots WHERE slot_key LIKE $1 || '%' AND status='done'
       ORDER BY slot_key DESC LIMIT $2`,
      [prefix, limit],
    );
    return r.rows;
  }

  // 单调头指针：仅当 incoming 更新时覆盖（WHERE 守卫保证不回退）。返回是否接受。
  async function updateHead(stream, objectKey, updatedAt, deviceId) {
    const r = await q(
      `INSERT INTO heads (stream, object_key, updated_at, device_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (stream) DO UPDATE
         SET object_key = EXCLUDED.object_key,
             updated_at = EXCLUDED.updated_at,
             device_id = EXCLUDED.device_id
         WHERE heads.updated_at IS NULL OR heads.updated_at < EXCLUDED.updated_at
       RETURNING stream`,
      [stream, objectKey, updatedAt, deviceId],
    );
    return r.rowCount > 0;
  }

  async function getHead(stream) {
    const r = await q(
      `SELECT stream, object_key, updated_at, device_id FROM heads WHERE stream=$1`,
      [stream],
    );
    return r.rows[0] || null;
  }

  async function registerDevice(deviceId, trustLevel = 0) {
    await q(
      `INSERT INTO devices (device_id, trust_level) VALUES ($1, $2)
       ON CONFLICT (device_id) DO NOTHING`,
      [deviceId, trustLevel],
    );
  }

  async function getDevice(deviceId) {
    const r = await q(`SELECT device_id, trust_level FROM devices WHERE device_id=$1`, [deviceId]);
    return r.rows[0] || null;
  }

  // 清扫：释放卡在 claimed（获胜方崩溃、未完成写入）超过时限的槽位，避免永久占用。
  async function releaseStaleClaims(cutoffIso) {
    const r = await q(`DELETE FROM slots WHERE status='claimed' AND created_at < $1`, [cutoffIso]);
    return r.rowCount;
  }

  async function close() { await pool.end(); }

  return { ensureSchema, tryClaim, completeSlot, getSlot, listSlots, updateHead, getHead, registerDevice, getDevice, releaseStaleClaims, close };
}

module.exports = { createDb };
