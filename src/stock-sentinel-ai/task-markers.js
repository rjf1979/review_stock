// 智诊盯盘 · 任务进度标记（第十五阶段 D15-05）
//
// 只有跨进程重启后仍需识别的后台队列才写标记。标记只描述「某队列最后一次是运行还是收尾」，
// 不保存业务结论，也不触发任何自动动作。读取方（task-recovery）据此把遗留 running 结算为 interrupted。
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./storage');

const MARKER_DIR = path.join(DATA_DIR, 'task-markers');
const MARKER_VERSION = 'task-marker-v1';

function safeName(name) {
  return String(name || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'marker';
}

function markerFile(name) {
  return path.join(MARKER_DIR, `${safeName(name)}.json`);
}

function writeMarker(name, data = {}) {
  try {
    fs.mkdirSync(MARKER_DIR, { recursive: true });
    const file = markerFile(name);
    const payload = { markerVersion: MARKER_VERSION, name: safeName(name), updatedAt: new Date().toISOString(), ...data };
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(temp, file);
    return { ok: true, file, marker: payload };
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) };
  }
}

function readMarker(name) {
  try {
    const file = markerFile(name);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? { ...parsed, file } : null;
  } catch {
    return null;
  }
}

function listMarkers() {
  try {
    if (!fs.existsSync(MARKER_DIR)) return [];
    return fs.readdirSync(MARKER_DIR)
      .filter((file) => file.endsWith('.json') && !file.endsWith('.tmp'))
      .sort()
      .map((file) => readMarker(file.replace(/\.json$/i, '')))
      .filter(Boolean);
  } catch {
    return [];
  }
}

// 队列开始：写 running 标记。
function startMarker(name, data = {}) {
  return writeMarker(name, { ...data, status: 'running', startedAt: new Date().toISOString(), finishedAt: '' });
}

// 队列收尾：标记完成/停止，并保留结果计数供排查。
function finishMarker(name, data = {}) {
  return writeMarker(name, { ...data, status: data.status || 'finished', finishedAt: new Date().toISOString() });
}

// 中断结算：只把 running 改成 interrupted，不改变其它字段、不重跑任务。
function interruptMarker(name, note = '') {
  const current = readMarker(name);
  if (!current || current.status !== 'running') return { ok: true, changed: 0, skipped: true, marker: current };
  const result = writeMarker(name, { ...current, status: 'interrupted', interruptedAt: new Date().toISOString(), note: String(note || '') });
  return { ok: result.ok, changed: result.ok ? 1 : 0, marker: result.marker, error: result.error };
}

module.exports = { MARKER_DIR, MARKER_VERSION, markerFile, writeMarker, readMarker, listMarkers, startMarker, finishMarker, interruptMarker };
