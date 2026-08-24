<script setup>
import { computed, onMounted, ref } from 'vue'

const adminSections = ['today', 'report-upload', 'reports', 'analysis', 'progress', 'users', 'ai', 'email', 'api-manual']
const adminPathSection = location.pathname.split('/')[2]
const isAdmin = location.pathname === '/admin' || (location.pathname.startsWith('/admin/') && adminSections.includes(adminPathSection))
const overview = ref(null)
const adminSessionPending = ref(isAdmin)
const gateKey = ref('')
const gateError = ref('')
const adminKey = ref('')
const activeSection = ref(adminSections.includes(adminPathSection) ? adminPathSection : 'today')
const reportPage = ref(1)
const selectedReport = ref(null)
const settings = ref(null)
const aiForm = ref({ provider: 'OpenAI Compatible', protocol: 'openai_responses', baseUrl: '', apiKey: '', model: '', timeoutSeconds: 300, enabled: true })
const aiSaveMessage = ref('')
const aiTesting = ref(false)
const aiKeyVisible = ref(false)
const apiManual = ref('')
const apiBaseUrl = ref('')
const apiUploadKey = ref('')
const manualUploadVisible = ref(false)
const copiedKey = ref('')
const apiManualLoading = ref(false)
const reportUploadForm = ref({ date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()), markdown: '' })
const reportUploading = ref(false)
const reportUploadMessage = ref('')
const adminMessage = ref('')
let adminMessageTimer = null
function flashMessage(text) {
  adminMessage.value = text
  if (adminMessageTimer) clearTimeout(adminMessageTimer)
  adminMessageTimer = setTimeout(() => { adminMessage.value = '' }, 4000)
}
function formatTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d)
}
function analysisStatusText(status) {
  return status === 'analyzed' ? '已生成' : status === 'waiting_market' ? '待生成' : status === 'failed' ? '失败' : status === 'running' ? '生成中' : (status || '-')
}
function renderStatusText(status) {
  return status === 'running' ? '渲染中' : status === 'failed' ? '渲染失败' : status === 'completed' ? '已完成' : '-'
}
const todayTask = computed(() => overview.value?.analysisTasks?.find(item => item.date === overview.value.today.date))
const renderStatus = computed(() => todayTask.value?.status || null)
const analysisDuration = computed(() => {
  const task = todayTask.value
  if (!task?.startedAt || !task?.completedAt) return '进行中'
  const seconds = Math.max(0, Math.round((new Date(task.completedAt) - new Date(task.startedAt)) / 1000))
  return seconds < 60 ? seconds + ' 秒' : Math.floor(seconds / 60) + ' 分 ' + (seconds % 60) + ' 秒'
})
const reportItems = computed(() => (overview.value?.reportList || []).slice(0, 60))
const reportPageSize = 10
const reportPages = computed(() => Math.max(1, Math.ceil(reportItems.value.length / reportPageSize)))
const pagedReports = computed(() => reportItems.value.slice((reportPage.value - 1) * reportPageSize, reportPage.value * reportPageSize))
function showReport(item) {
  selectedReport.value = item
}
function changeReportPage(page) {
  reportPage.value = Math.min(reportPages.value, Math.max(1, page))
  selectedReport.value = null
}
async function resetReport(item) {
  const date = item.date
  if (!confirm(`确定重置 ${date} 的报告？将删除该日已生成报告并允许重新上传。`)) return
  const response = await api('/api/admin/reports/reset', { method: 'POST', body: JSON.stringify({ date }) })
  const result = await response.json()
  flashMessage(response.ok ? `已重置 ${date} 的报告` : (result.error || '重置失败'))
  if (response.ok) { selectedReport.value = null; await loadOverview() }
}
async function regenerateReport(item) {
  const date = item.date
  if (!confirm(`确定重新生成 ${date} 的报告？将用当前 AI 配置重新排版该日报告，约 1-2 分钟完成。`)) return
  const response = await api('/api/admin/reports/regenerate', { method: 'POST', body: JSON.stringify({ date }) })
  const result = await response.json()
  flashMessage(response.ok ? `已触发 ${date} 报告重新生成，约 1-2 分钟后完成。` : (result.error || '重新生成失败'))
}
const userSearch = ref('')
const userPage = ref(1)
const userPageSize = 10
const filteredUsers = computed(() => {
  const q = userSearch.value.trim().toLowerCase()
  const list = overview.value?.users || []
  return q ? list.filter(u => String(u.email || '').toLowerCase().includes(q)) : list
})
const userPages = computed(() => Math.max(1, Math.ceil(filteredUsers.value.length / userPageSize)))
const pagedUsers = computed(() => {
  const start = (userPage.value - 1) * userPageSize
  return filteredUsers.value.slice(start, start + userPageSize)
})
const userStats = computed(() => {
  const list = overview.value?.users || []
  return { total: list.length, verified: list.filter(u => u.verified).length, pending: list.filter(u => !u.verified).length }
})
function changeUserPage(page) { userPage.value = Math.min(userPages.value, Math.max(1, page)) }

const api = (path, options = {}) => fetch(path, { ...options, headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey.value || gateKey.value, ...(options.headers || {}) } })
async function unlock() {
  const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: gateKey.value }) })
  if (!response.ok) { gateError.value = '授权密码不正确。'; return }
  adminKey.value = gateKey.value; gateKey.value = ''; await loadOverview()
}
async function loadOverview() {
  const response = await api('/api/admin/overview')
  if (response.ok) { overview.value = await response.json(); await loadSettings() }
}
async function loadSettings() {
  const response = await api('/api/admin/settings')
  if (!response.ok) return
  settings.value = await response.json()
  const ai = settings.value.ai
  aiForm.value = { provider: ai.provider || 'OpenAI Compatible', protocol: ai.protocol || 'openai_responses', baseUrl: ai.baseUrl || '', apiKey: ai.apiKey || '', model: ai.model || '', timeoutSeconds: ai.timeoutSeconds || 300, enabled: ai.enabled !== false }
}
async function saveAiSettings() {
  aiSaveMessage.value = '保存中…'
  const response = await api('/api/admin/settings/ai', { method: 'PUT', body: JSON.stringify(aiForm.value) })
  const result = await response.json()
  aiSaveMessage.value = response.ok ? 'AI 配置已保存' : (result.error || '保存失败')
  if (response.ok) await loadSettings()
}
async function testAiSettings() {
  aiTesting.value = true; aiSaveMessage.value = '正在检测模型服务…'
  try {
    const response = await api('/api/admin/settings/ai/test', { method: 'POST', body: '{}' })
    const result = await response.json()
    aiSaveMessage.value = response.ok ? result.message : (result.error || '检测失败')
  } finally { aiTesting.value = false }
}
async function saveReport() {
  reportUploading.value = true; reportUploadMessage.value = '正在保存并生成报告…'
  try {
    const response = await api('/api/admin/reports/upload', { method: 'POST', body: JSON.stringify(reportUploadForm.value) })
    const result = await response.json()
    reportUploadMessage.value = response.ok ? `已保存报告：${result.title}（${result.date}），AI 排版约 1-2 分钟完成。` : (result.error || '保存失败')
    if (response.ok) await loadOverview()
  } finally { reportUploading.value = false }
}
async function loadApiManual() {
  apiManualLoading.value = true
  try {
    const response = await api('/api/admin/api-manual')
    if (!response.ok) return
    const result = await response.json()
    apiManual.value = result.manual || ''
    apiBaseUrl.value = result.baseUrl || ''
    apiUploadKey.value = result.uploadKey || ''
  } finally { apiManualLoading.value = false }
}
async function copyText(text, key) {
  const done = () => { copiedKey.value = key; setTimeout(() => { if (copiedKey.value === key) copiedKey.value = '' }, 2000) }
  try {
    await navigator.clipboard.writeText(String(text || ''))
    done()
  } catch {
    const ta = document.createElement('textarea')
    ta.value = String(text || '')
    ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy'); done() } catch { copiedKey.value = '' }
    document.body.removeChild(ta)
  }
}
onMounted(async () => {
  if (isAdmin) {
    try {
      const session = await fetch('/api/admin/session').then(response => response.json())
      if (session.authenticated) { await Promise.all([loadOverview(), loadApiManual()]) }
    } finally { adminSessionPending.value = false }
  }
})
</script>

<template>
  <div v-if="!isAdmin" class="app-shell">
    <header class="nav"><a class="logo" href="/">行情日报<span>DESKTOP MARKET DESK</span></a><nav><a href="#features">功能</a><a href="#how">工作方式</a><a href="#download">下载</a></nav></header>
    <main>
      <section class="site-hero"><div class="hero-copy"><p class="kicker">LOCAL MARKET DESK · 免费桌面版</p><h1>A 股行情，<br><em>一屏看懂。</em></h1><p class="lede">实时行情、板块、龙虎榜和收盘复盘。数据在你的电脑本地整理，打开应用就能开始工作。</p><div class="actions"><a class="primary" href="#download">下载桌面版</a><a class="text-link" href="#features">查看功能</a></div><p class="fine">Windows · macOS · 免费 · 不需要交易账户</p></div><div class="hero-console" aria-label="行情日报桌面版功能预览"><div class="console-bar"><span class="console-brand"><i></i> 行情日报</span><span class="console-caption">DESKTOP APP</span><span class="console-status">● 本地运行</span></div><div class="console-content"><div class="console-heading"><div><small>MARKET DESK / FEATURES</small><strong>收盘后的工作台</strong></div><span class="console-refresh">无账号也能使用</span></div><div class="console-indices"><div class="console-index"><small>实时行情</small><strong>--</strong><span>本地更新</span></div><div class="console-index"><small>每日复盘</small><strong>15:35</strong><span>工作日生成</span></div><div class="console-index"><small>系统通知</small><strong>可选</strong><span>托盘运行</span></div></div><div class="console-table"><div><span>数据来源</span><b>腾讯行情 · 东方财富</b></div><div><span>运行方式</span><b>本地直连公开接口</b></div><div><span>支持平台</span><b>Windows · macOS</b></div></div></div></div></section>
      <section id="features" class="feature-section"><div class="section-heading"><p class="kicker">ONE SCREEN, EIGHT BLOCKS</p><h2>为每天收盘后的十分钟设计</h2><p>把需要反复打开的行情入口，收拢成一张安静、可扫描的桌面工作台。</p></div><div class="feature-grid"><article><span class="feature-index">01</span><h3>实时行情</h3><p>A 股指数与自选股实时报价，刷新频率可调，涨跌语义清晰。</p></article><article><span class="feature-index">02</span><h3>每日复盘</h3><p>市场温度、大盘概览、资金流、海外市场和要闻集中呈现。</p></article><article><span class="feature-index">03</span><h3>板块与龙虎榜</h3><p>领涨板块、涨停连板梯队和龙虎榜净买入，收盘后一次看完。</p></article><article><span class="feature-index">04</span><h3>本地直连公开数据</h3><p>腾讯行情与东方财富公开接口在本地整理，不经过平台服务器中转。</p></article></div></section>
      <section id="how" class="how section"><div class="section-heading"><p class="kicker">HOW IT WORKS</p><h2>从数据到桌面，只需三步</h2></div><div class="steps"><div><b>01</b><h3>安装桌面版</h3><p>Windows 和 macOS 安装包发布后可直接下载使用。</p></div><div><b>02</b><h3>本地抓取行情</h3><p>应用直接读取公开行情源，在本机整理实时数据。</p></div><div><b>03</b><h3>收盘后查看</h3><p>工作日 15:35 后生成复盘，完成时可发送系统通知。</p></div></div></section>
      <section id="download" class="download-section"><div><p class="kicker">DESKTOP RELEASE</p><h2>把行情日报放在桌面上</h2><p>正式安装包正在准备。当前网站先完成产品介绍与下载入口，版本发布后会在这里提供校验过的安装文件。</p></div><div class="download-options"><button class="download-option" type="button" disabled><span>Windows</span><strong>安装包准备中</strong><small>即将提供 · 免费</small></button><button class="download-option" type="button" disabled><span>macOS</span><strong>安装包准备中</strong><small>即将提供 · 免费</small></button></div></section>
      <section id="data" class="compliance-section section"><div class="section-heading"><p class="kicker">DATA &amp; DISCLAIMER</p><h2>数据从哪里来？</h2></div><div class="compliance-grid"><div><h3>公开来源，本地整理</h3><p>行情日报使用腾讯行情、东方财富等公开免费数据源。桌面版在本地取数和整理，不采集你的交易信息，也不经过平台服务器中转。</p></div><div><h3>免责声明</h3><p>行情日报仅提供行情数据的展示与整理，所有数据来自公开来源，仅供参考，不构成任何投资建议。「市场温度」「情绪指标」等均为统计性描述，不代表未来走势，不构成买卖信号。股市有风险，投资需谨慎。</p></div></div></section>
    </main>
    <footer><span>© 2026 行情日报 · Desktop Market Desk</span><span><a href="#data">数据来源与免责声明</a> · <a href="#download">下载</a></span></footer>
  </div>

  <div v-else class="admin-body">
    <header class="nav"><a class="logo" href="/">行情日报<span>ADMIN CONSOLE</span></a><nav><a href="/">返回首页</a></nav></header>
    <main class="admin-shell">
      <section v-if="adminSessionPending" class="admin-loading" role="status" aria-live="polite">正在验证后台会话…</section>
      <section v-else-if="!overview" class="admin-gate"><p class="gate-mark">SECURE ADMIN</p><h1>进入行情日报后台</h1><p>请输入后台授权密码。</p><label>授权密码<input v-model="gateKey" type="password" @keyup.enter="unlock"></label><button class="primary" @click="unlock">验证并进入</button><p class="gate-error">{{ gateError }}</p></section>
      <template v-else><aside class="admin-sidebar"><h2>行情日报</h2><small>OPERATIONS DESK</small><nav><a href="/admin/today" :class="{active: activeSection === 'today'}">今日状态</a><a href="/admin/report-upload" :class="{active: activeSection === 'report-upload'}">报告上传</a><a href="/admin/reports" :class="{active: activeSection === 'reports'}">每日报告</a><a href="/admin/analysis" :class="{active: activeSection === 'analysis'}">分析任务</a><a href="/admin/progress" :class="{active: activeSection === 'progress'}">发送进度</a><a href="/admin/users" :class="{active: activeSection === 'users'}">历史用户</a><a href="/admin/ai" :class="{active: activeSection === 'ai'}">AI 设置</a><a href="/admin/api-manual" :class="{active: activeSection === 'api-manual'}">API 对接手册</a></nav><div class="side-status">授权状态<br><strong>已验证会话</strong></div></aside><section class="admin-content"><div class="admin-head"><div><p class="kicker">OPERATIONS</p><h1>行情日报后台</h1><p>外部分析服务上传当日报告后，可在后台预览和管理报告。</p></div><button class="ghost" @click="loadOverview">↻ 刷新数据</button></div><p v-if="adminMessage" class="toast" role="status" aria-live="polite">{{ adminMessage }}</p>
        <div v-if="activeSection === 'today'" class="admin-page"><section class="panel"><div class="page-title"><div><h2>今日行情分析</h2><p class="today-date">{{ overview.today.date }}</p></div><span class="status" :class="overview.today.analysisStatus === 'analyzed' ? 'ready' : ''">{{ overview.today.analysisStatus === 'analyzed' ? '报告已生成' : '报告未生成' }}</span></div><div class="stats today-stats"><div class="stat"><small>AI 渲染</small><b><span v-if="renderStatus === 'running'" class="task-spinner" aria-hidden="true"></span>{{ renderStatusText(renderStatus) }}</b></div><div class="stat"><small>报告状态</small><b>{{ overview.today.analysisStatus === 'analyzed' ? '可查看' : '等待上传' }}</b></div></div><div class="notice notice-disabled" role="status" aria-live="polite"><strong>邮件订阅已停用</strong><span>报告仍会保存在平台并可从“每日报告”查看，不再注册用户、不再发送邮件。</span></div></section></div>
        <div v-else-if="activeSection === 'reports'" class="admin-page report-page"><section class="panel"><div class="page-title"><div><h2>每日报告</h2><p>最近 60 个交易日，按日期从新到旧排列。可对已生成报告重新生成，或重置后重新上传。</p></div><span class="page-count">{{ reportItems.length }} 个交易日</span></div><div class="report-grid"><div v-for="item in pagedReports" :key="item.date" class="report-card"><div class="report-card-head"><strong>{{ item.date }}</strong><span v-if="item.analysis?.temperature != null" class="report-temp">{{ item.analysis.temperature }}°</span></div><div class="report-badges"><span class="status" :class="item.analysisStatus === 'analyzed' ? 'ready' : ''">{{ item.analysisStatus === 'analyzed' ? '已生成' : '待生成' }}</span><span class="status">邮件已停用</span><span v-if="item.renderStatus === 'running'" class="status"><span class="task-spinner" aria-hidden="true"></span>渲染中</span><span v-else-if="item.renderStatus === 'failed'" class="status fail">渲染失败</span></div><p v-if="item.analysis?.summary" class="report-row-summary">{{ item.analysis.summary }}</p><div class="report-card-actions"><a v-if="item.reportPath" :href="item.reportPath" target="_blank" rel="noreferrer">查看报告 ↗</a><button v-if="item.analysisStatus === 'analyzed'" type="button" class="report-reset" @click="regenerateReport(item)">重新生成</button><button type="button" class="report-reset" @click="resetReport(item)">重置</button></div></div></div><p v-if="!pagedReports.length" class="notice">暂无交易日报记录。</p><div class="pagination"><button type="button" :disabled="reportPage === 1" @click="changeReportPage(reportPage - 1)">上一页</button><button v-for="page in reportPages" :key="page" type="button" :class="{current: reportPage === page}" @click="changeReportPage(page)">{{ page }}</button><button type="button" :disabled="reportPage === reportPages" @click="changeReportPage(reportPage + 1)">下一页</button></div></section></div>
        <div v-else-if="activeSection === 'analysis'" class="admin-page"><section class="panel"><h2>分析任务</h2><div class="table-wrap"><table class="admin-table"><thead><tr><th>交易日</th><th>触发方式</th><th>状态</th><th>开始时间</th><th>完成时间</th></tr></thead><tbody><tr v-for="item in overview.analysisTasks" :key="item.date"><td>{{ item.date }}</td><td>{{ item.trigger === 'upload' ? '外部分析上传' : item.trigger === 'manual' ? '后台重新生成' : (item.trigger || '-') }}</td><td><span class="task-status" :class="item.status"><span v-if="item.status === 'running'" class="task-spinner" aria-hidden="true"></span>{{ item.status === 'running' ? '生成中' : item.status === 'completed' ? '已完成' : item.status === 'failed' ? '失败' : '等待中' }}</span></td><td>{{ formatTime(item.startedAt) }}</td><td>{{ formatTime(item.completedAt) }}</td></tr><tr v-if="!overview.analysisTasks?.length"><td colspan="5" class="empty-cell">暂无分析任务。</td></tr></tbody></table></div></section></div>
        <div v-else-if="activeSection === 'progress'" class="admin-page"><section class="panel"><div class="page-title"><div><h2>发送进度</h2><p>该页面保留用于说明历史数据状态。</p></div><span class="status">已停用</span></div><div class="notice notice-disabled" role="status" aria-live="polite"><strong>邮件订阅已停用</strong><span>平台不再创建发送任务、记录发送进度或调用邮件服务。</span></div></section></div>
        <div v-else-if="activeSection === 'users'" class="admin-page"><section class="panel"><div class="page-title"><div><h2>历史用户</h2><p>历史注册数据仅为兼容保留，不再接受新注册或恢复邮件订阅。共 {{ userStats.total }} 条记录。</p></div><span class="page-count">显示 {{ pagedUsers.length }} / {{ filteredUsers.length }}</span></div><div class="notice notice-disabled" role="status" aria-live="polite"><strong>邮件订阅已停用</strong><span>以下列表仅供历史数据核对，不包含任何注册、验证或订阅操作。</span></div><div class="table-toolbar"><input v-model.trim="userSearch" type="search" placeholder="按邮箱搜索…" aria-label="搜索历史用户"></div><div class="table-wrap"><table class="admin-table"><thead><tr><th>邮箱</th><th>历史验证状态</th><th>注册时间</th></tr></thead><tbody><tr v-for="user in pagedUsers" :key="user.id"><td>{{ user.email }}</td><td>{{ user.verified ? '已验证' : '待验证' }}</td><td>{{ formatTime(user.createdAt) }}</td></tr><tr v-if="!pagedUsers.length"><td colspan="3" class="empty-cell">暂无历史用户{{ userSearch ? '（无匹配结果）' : '' }}。</td></tr></tbody></table></div><div v-if="userPages > 1" class="pagination"><button type="button" :disabled="userPage === 1" @click="changeUserPage(userPage - 1)">上一页</button><button v-for="page in userPages" :key="page" type="button" :class="{current: userPage === page}" @click="changeUserPage(page)">{{ page }}</button><button type="button" :disabled="userPage === userPages" @click="changeUserPage(userPage + 1)">下一页</button></div></section></div>
        <div v-else-if="activeSection === 'ai'" class="admin-page settings-page"><section class="panel"><div class="page-title"><div><h2>AI 设置</h2><p>配置用于把行情 Markdown 排版为精美 HTML 报告的 GPT 或 Claude 模型服务。AI 从零设计排版并提炼首页数据（温度、指数、广度、主线等）；未配置或调用失败时回退基础渲染。</p></div><span class="status" :class="{ready: settings?.ai?.apiKeyMasked}">{{ settings?.ai?.apiKeyMasked ? '已配置' : '未配置' }}</span></div><div class="settings-summary"><div><small>服务商</small><strong>{{ settings?.ai?.provider || 'OpenAI Compatible' }}</strong></div><div><small>当前模型</small><strong>{{ settings?.ai?.model || '未设置' }}</strong></div><div><small>调用协议</small><strong>{{ settings?.ai?.protocol === 'anthropic_messages' ? 'Claude Messages API' : 'GPT Responses API' }}</strong></div></div><form class="settings-form" @submit.prevent="saveAiSettings"><div class="settings-grid"><label>服务商名称<input v-model.trim="aiForm.provider" maxlength="80" required></label><label>接口格式<select v-model="aiForm.protocol"><option value="openai_responses">GPT Responses API</option><option value="anthropic_messages">Claude Messages API</option></select></label><label>模型 ID<input v-model.trim="aiForm.model" maxlength="200" required placeholder="例如 gpt-5.6-luna 或 claude-sonnet-4-5"></label><label>接口超时（秒）<input v-model.number="aiForm.timeoutSeconds" type="number" min="30" max="3600" required></label><label class="settings-span-2">Base URL<input v-model.trim="aiForm.baseUrl" type="url" placeholder="https://api.openai.com/v1 或 https://api.anthropic.com/v1"></label><label class="settings-span-2">API Key<span class="secret-input"><input v-model.trim="aiForm.apiKey" :type="aiKeyVisible ? 'text' : 'password'" autocomplete="new-password" placeholder="输入 API Key"><button type="button" class="secret-toggle" :aria-label="aiKeyVisible ? '隐藏 AI API Key' : '显示 AI API Key'" :aria-pressed="aiKeyVisible" @click="aiKeyVisible = !aiKeyVisible">{{ aiKeyVisible ? '隐藏' : '显示' }}</button></span></label></div><div class="settings-switches"><label><input v-model="aiForm.enabled" type="checkbox"> 启用 AI 排版（未启用或调用失败时回退到默认渲染）</label></div><div class="settings-actions"><button type="button" :disabled="aiTesting" @click="testAiSettings">{{ aiTesting ? '检测中…' : '检测连接' }}</button><button class="primary" type="submit">保存 AI 配置</button><span role="status" aria-live="polite">{{ aiSaveMessage }}</span></div></form></section></div>
        <div v-else-if="activeSection === 'email'" class="admin-page settings-page"><section class="panel"><div class="page-title"><div><h2>邮件设置</h2><p>该页面保留用于说明历史配置状态。</p></div><span class="status">已停用</span></div><div class="notice notice-disabled" role="status" aria-live="polite"><strong>邮件订阅已停用</strong><span>Resend 配置不再读取或修改，平台不会发送验证邮件、日报或其他订阅邮件。</span></div></section></div>
        <div v-else-if="activeSection === 'report-upload'" class="admin-page settings-page"><section class="panel"><div class="page-title"><div><h2>报告上传</h2><p>手动保存当日行情报告的 Markdown，与外部接口上传共用同一处理机制：渲染 HTML、标记为已分析。</p></div><span class="status" :class="{ready: overview.today.analysisStatus === 'analyzed'}">{{ overview.today.analysisStatus === 'analyzed' ? '今日报告已生成' : '今日报告未生成' }}</span></div><form class="settings-form" @submit.prevent="saveReport"><div class="settings-grid"><label>交易日<input v-model.trim="reportUploadForm.date" type="date" required></label></div><div class="skill-editor"><div class="editor-head"><h3>报告 Markdown</h3><span role="status" aria-live="polite">{{ reportUploadMessage }}</span></div><textarea v-model="reportUploadForm.markdown" spellcheck="false" placeholder="# A股收盘复盘&#10;&#10;正文…（支持 YAML frontmatter 的 title / summary）" aria-label="报告 Markdown 内容"></textarea><button class="primary" :disabled="reportUploading" type="submit">{{ reportUploading ? '保存中…' : '保存并生成报告' }}</button></div></form></section></div>
        <div v-else-if="activeSection === 'api-manual'" class="admin-page settings-page"><section class="panel"><div class="page-title"><div><h2>API 对接手册</h2><p>上传每日行情（报告 MD）接口对接说明。下方为真实接入信息与完整对接文本，复制后可直接给外部分析服务或 AI 工具使用；上传密钥请妥善保管。</p></div><button class="ghost refresh-button" type="button" @click="loadApiManual">↻ 刷新</button></div><div class="settings-summary api-cred"><div><small>Base URL</small><strong>{{ apiBaseUrl || '—' }}</strong><button class="manual-copy" type="button" @click="copyText(apiBaseUrl, 'base')">{{ copiedKey === 'base' ? '已复制 ✓' : '复制' }}</button></div><div><small>上传密钥 · x-upload-key</small><strong><span class="secret-input"><input :type="manualUploadVisible ? 'text' : 'password'" :value="apiUploadKey || '—'" readonly aria-label="上传密钥"><button type="button" class="secret-toggle" :aria-label="manualUploadVisible ? '隐藏上传密钥' : '显示上传密钥'" :aria-pressed="manualUploadVisible" @click="manualUploadVisible = !manualUploadVisible">{{ manualUploadVisible ? '隐藏' : '显示' }}</button></span></strong><button class="manual-copy" type="button" @click="copyText(apiUploadKey, 'upload')">{{ copiedKey === 'upload' ? '已复制 ✓' : '复制' }}</button></div></div><div class="settings-actions" style="justify-content:space-between"><span role="status" aria-live="polite">{{ apiManualLoading ? '正在加载对接文本…' : (apiManual ? '已加载完整对接文本（含真实密钥）。' : '') }}</span><button class="primary" type="button" :disabled="apiManualLoading" @click="copyText(apiManual, 'full')">{{ copiedKey === 'full' ? '已复制全文 ✓' : '复制全文（含真实密钥）' }}</button></div><pre v-if="apiManual" class="manual-pre">{{ apiManual }}</pre><p v-else class="notice">正在加载对接手册…</p></section></div>
      </section></template>
    </main>
  </div>
</template>
