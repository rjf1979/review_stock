// 智诊盯盘 · 设置存储路径回归：打包后必须写入可写数据目录，不得落在只读 app.asar 内。
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-settings-'));
process.env.VOLUME_INSIGHT_DATA_DIR = TMP;

const SETTINGS_MODULE = require.resolve('../settings');
const settings = require('../settings');

// ── 打包/桌面模式：跟随 VOLUME_INSIGHT_DATA_DIR（Electron 下为 userData）──
assert.ok(!settings.FILE.includes('app.asar'), 'settings.json 不得写进 app.asar');
assert.strictEqual(path.dirname(settings.FILE), path.resolve(TMP), 'FILE 应落在数据目录内');
assert.strictEqual(path.basename(settings.FILE), 'settings.json');

const saved = settings.save({ fetchDays: 30, ai: { enabled: true, model: 'gpt-test', apiKey: 'sk-local-test' } });
assert.strictEqual(saved.fetchDays, 30, 'fetchDays 应被接受');
assert.strictEqual(saved.ai.enabled, true, 'ai.enabled 应被接受');
assert.strictEqual(saved.ai.model, 'gpt-test', 'ai.model 应被接受');
assert.ok(fs.existsSync(settings.FILE), '保存后应存在 settings.json');
assert.strictEqual(settings.load().ai.model, 'gpt-test', '重新读取应回读到刚保存的值');

// ── 不可写目录：应抛出带落盘路径的错误，而不是静默失败 ──
const blocker = path.join(TMP, 'blocked-parent');
fs.writeFileSync(blocker, 'not a directory', 'utf8');
delete require.cache[SETTINGS_MODULE];
process.env.VOLUME_INSIGHT_DATA_DIR = path.join(blocker, 'nested');
const blockedSettings = require('../settings');
assert.throws(() => blockedSettings.save({ fetchDays: 60 }), (e) => {
  assert.strictEqual(e.code, 'ENOTDIR', '父路径是文件时应保留 ENOTDIR');
  assert.ok(e.message.includes('设置写入失败'), '错误应带中文前缀');
  assert.ok(e.message.includes('settings.json'), '错误应带落盘路径');
  return true;
});

// ── 未设置环境变量（开发/Web 调试）：回退源码 data/，与既有开发约定一致 ──
delete require.cache[SETTINGS_MODULE];
delete process.env.VOLUME_INSIGHT_DATA_DIR;
const devSettings = require('../settings');
assert.strictEqual(devSettings.FILE, path.join(__dirname, '..', 'data', 'settings.json'), '开发模式应回退源码 data/settings.json');

fs.rmSync(TMP, { recursive: true, force: true });
console.log('settings-path.test 通过');
