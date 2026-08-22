const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/postgres';
const pool = new Pool({ connectionString, max: 4 });
const emptyState = () => ({ users: [], sessions: [], adminSessions: [], deliveries: [], tradingDays: [], lastDispatchDate: null });
const defaultAppConfig = () => ({
  provider: 'OpenAI Compatible', protocol: 'openai_responses', baseUrl: '', apiKey: '', model: '', timeoutSeconds: 300, aiEnabled: true,
  resendApiKey: '', emailFrom: '', emailEnabled: true, uploadKey: '', updatedAt: null
});

function mapAppConfig(row) {
  return {
    ...defaultAppConfig(),
    ...(row ? {
      provider: row.ai_provider, protocol: row.ai_protocol || 'openai_responses', baseUrl: row.ai_base_url || '', apiKey: row.ai_api_key || '', model: row.ai_model || '',
      timeoutSeconds: row.ai_timeout_seconds, aiEnabled: row.ai_enabled, resendApiKey: row.resend_api_key || '',
      emailFrom: row.email_from || '', emailEnabled: row.email_enabled, uploadKey: row.upload_key || '', updatedAt: row.updated_at
    } : {})
  };
}

async function initializeDatabase() {
  await pool.query("CREATE TABLE IF NOT EXISTS app_state (id SMALLINT PRIMARY KEY CHECK (id = 1), data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE TABLE IF NOT EXISTS app_settings (id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), ai_provider TEXT NOT NULL DEFAULT 'OpenAI Compatible', ai_protocol TEXT NOT NULL DEFAULT 'openai_responses', ai_base_url TEXT, ai_api_key TEXT, ai_model TEXT, ai_timeout_seconds INTEGER NOT NULL DEFAULT 300 CHECK (ai_timeout_seconds BETWEEN 30 AND 3600), ai_enabled BOOLEAN NOT NULL DEFAULT TRUE, resend_api_key TEXT, email_from TEXT, email_enabled BOOLEAN NOT NULL DEFAULT TRUE, upload_key TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ai_protocol TEXT NOT NULL DEFAULT 'openai_responses'; ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS upload_key TEXT;");
  await pool.query('INSERT INTO app_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [emptyState()]);
  await pool.query('INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
}

async function loadState() {
  const result = await pool.query('SELECT data FROM app_state WHERE id = 1');
  return { ...emptyState(), ...(result.rows[0]?.data || {}) };
}

async function saveState(state) {
  await pool.query('UPDATE app_state SET data = $1, updated_at = NOW() WHERE id = 1', [state]);
}

async function loadAppConfig() {
  const result = await pool.query('SELECT * FROM app_settings WHERE id = 1');
  return mapAppConfig(result.rows[0]);
}

async function saveAppConfig(patch = {}) {
  const fields = [];
  const values = [];
  const allowed = {
    provider: 'ai_provider', protocol: 'ai_protocol', baseUrl: 'ai_base_url', apiKey: 'ai_api_key', model: 'ai_model', timeoutSeconds: 'ai_timeout_seconds',
    aiEnabled: 'ai_enabled', resendApiKey: 'resend_api_key', emailFrom: 'email_from', emailEnabled: 'email_enabled', uploadKey: 'upload_key'
  };
  for (const [key, column] of Object.entries(allowed)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      values.push(patch[key]);
      fields.push(`${column} = $${values.length}`);
    }
  }
  if (!fields.length) return loadAppConfig();
  const result = await pool.query(`UPDATE app_settings SET ${fields.join(', ')}, updated_at = NOW() WHERE id = 1 RETURNING *`, values);
  return mapAppConfig(result.rows[0]);
}

module.exports = { emptyState, initializeDatabase, loadState, saveState, loadAppConfig, saveAppConfig };
