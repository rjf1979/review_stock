-- 股市脉搏 · 云端行情 API（众包采集）· 三表
-- 与 db.js 的 ensureSchema 保持一致；可直接 psql 执行，也可由服务启动时幂等建表。

CREATE TABLE IF NOT EXISTS devices (
  device_id  TEXT PRIMARY KEY,
  trust_level INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slots (
  slot_key   TEXT PRIMARY KEY,
  status     TEXT NOT NULL DEFAULT 'claimed',   -- claimed | done
  device_id  TEXT NOT NULL,
  object_key TEXT,
  etag       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS slots_done_idx ON slots (status, slot_key);

CREATE TABLE IF NOT EXISTS heads (
  stream     TEXT PRIMARY KEY,                  -- 'realtime' | 'quotes'
  object_key TEXT,
  updated_at TIMESTAMPTZ,
  device_id  TEXT
);
