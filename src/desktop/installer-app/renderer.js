const checkList = document.querySelector('#check-list');
const statusElement = document.querySelector('#status');
const versionElement = document.querySelector('#version');
const notesElement = document.querySelector('#notes');
const progressWrap = document.querySelector('#progress-wrap');
const progressElement = document.querySelector('#progress');
const progressFill = document.querySelector('#progress-fill');
const progressLabel = document.querySelector('#progress-label');
const progressValue = document.querySelector('#progress-value');
const retryButton = document.querySelector('#retry');
const recheckButton = document.querySelector('#recheck');
const quitButton = document.querySelector('#quit');

function formatBytes(bytes) {
  if (!Number.isFinite(Number(bytes))) return '未知';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function renderChecks(checks) {
  const rows = [
    ['系统', checks.platform],
    ['Windows 版本', checks.windows],
    ['系统架构', checks.architecture],
    ['磁盘空间', checks.disk],
    ['运行库', checks.vcRuntime],
  ];
  checkList.replaceChildren(...rows.map(([title, item]) => {
    const node = document.createElement('li');
    node.className = `check ${item.ok ? 'ok' : item.warningOnly ? 'warn' : 'error'}`;
    const name = document.createElement('b');
    name.textContent = `${item.ok ? '通过' : item.warningOnly ? '提示' : '未通过'} · ${title}`;
    const detail = document.createElement('span');
    detail.textContent = item.label;
    node.append(name, detail);
    return node;
  }));
}

function renderProgress(progress) {
  progressWrap.hidden = !progress;
  progressElement.classList.toggle('indeterminate', Boolean(progress) && !progress.total);
  if (!progress) return;
  const percent = progress.percent;
  progressElement.setAttribute('aria-valuenow', percent == null ? '0' : String(percent));
  progressFill.style.width = percent == null ? '38%' : `${percent}%`;
  progressValue.textContent = percent == null ? `${formatBytes(progress.received)} / 未知` : `${percent}%`;
  progressLabel.textContent = percent == null ? '下载中' : `已下载 ${formatBytes(progress.received)} / ${formatBytes(progress.total)}`;
}

function applyState(state = {}) {
  statusElement.className = `status ${state.phase === 'error' ? 'error' : state.phase === 'success' ? 'success' : ''}`;
  statusElement.textContent = state.message || '正在准备…';
  if (state.version) {
    versionElement.textContent = `v${state.version}`;
    versionElement.classList.add('ok');
  }
  renderProgress(state.progress);
  notesElement.replaceChildren(...(state.notes || []).map(note => {
    const node = document.createElement('li');
    node.textContent = note;
    return node;
  }));
  retryButton.disabled = state.phase !== 'error';
}

async function runInstall() {
  retryButton.disabled = true;
  recheckButton.disabled = true;
  try {
    const environment = await window.installerBridge.readEnvironment();
    renderChecks(environment);
    if (!environment.ready) {
      applyState({ phase: 'error', message: '环境检查未通过，请处理后重新检查。' });
      return;
    }
    applyState({ phase: 'checking', message: '环境检查通过，正在获取最新版本…' });
    await window.installerBridge.startInstall();
  } catch (error) {
    applyState({ phase: 'error', message: error.message || '安装准备失败' });
  } finally {
    recheckButton.disabled = false;
  }
}

window.installerBridge.onStateChanged(applyState);
retryButton.addEventListener('click', runInstall);
recheckButton.addEventListener('click', runInstall);
quitButton.addEventListener('click', () => window.close());
runInstall();
