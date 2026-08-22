<script setup>
import { computed, onMounted, ref } from 'vue'

const adminSections = ['today', 'report-upload', 'reports', 'analysis', 'progress', 'users', 'ai', 'email', 'api-manual']
const adminPathSection = location.pathname.split('/')[2]
const isAdmin = location.pathname === '/admin' || (location.pathname.startsWith('/admin/') && adminSections.includes(adminPathSection))
const day = ref({ date: '今日', analysisStatus: 'waiting', analysis: null, reportPath: null })
const me = ref(null)
const isSubscribed = computed(() => !!me.value?.subscriptions?.includes('daily-review'))
const modal = ref(false)
const form = ref({ email: '' })
const message = ref('')
const pending = ref(false)
const overview = ref(null)
const adminSessionPending = ref(isAdmin)
const gateKey = ref('')
const gateError = ref('')
const adminKey = ref('')
const activeSection = ref(adminSections.includes(adminPathSection) ? adminPathSection : 'today')
const reportPage = ref(1)
const selectedReport = ref(null)
const settings = ref(null)
const emailForm = ref({ apiKey: '', from: '', enabled: true })
const emailSaveMessage = ref('')
const emailKeyVisible = ref(false)
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
const ready = computed(() => day.value.analysisStatus === 'analyzed')
const latest = computed(() => day.value.latestAnalyzed || null)
const display = computed(() => (ready.value ? day.value : (latest.value || day.value)))
const isShowingPrevious = computed(() => !ready.value && !!latest.value)
const nothingReady = computed(() => !ready.value && !latest.value)
const analysis = computed(() => display.value.analysis || {})
const indices = computed(() => Array.isArray(analysis.value.indices) ? analysis.value.indices : [])
const mainline = computed(() => Array.isArray(analysis.value.mainline) ? analysis.value.mainline : [])
const leadingStocks = computed(() => Array.isArray(analysis.value.leadingStocks) ? analysis.value.leadingStocks : [])
const nextFocus = computed(() => Array.isArray(analysis.value.nextFocus) ? analysis.value.nextFocus : [])
const breadthStats = computed(() => {
  const b = analysis.value.breadth || {}
  return [
    { label: '上涨', value: b.up, cls: 'up' },
    { label: '下跌', value: b.down, cls: 'down' },
    { label: '涨停', value: b.limitUp, cls: 'up' },
    { label: '跌停', value: b.limitDown, cls: 'down' },
    { label: '连板', value: b.streak, cls: '' },
    { label: '成交额', value: b.turnover, cls: '' }
  ].filter(item => item.value !== null && item.value !== undefined && item.value !== '')
})
const marketBand = computed(() => indices.value.length || breadthStats.value.length || mainline.value.length || leadingStocks.value.length || nextFocus.value.length)
function signed(change) {
  const s = String(change || '')
  if (s.startsWith('+')) return 'up'
  if (s.startsWith('-')) return 'down'
  return ''
}
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
const subscribed = computed(() => overview.value?.users.filter(user => user.subscriptions.includes('daily-review')).length || 0)
const todayTask = computed(() => overview.value?.analysisTasks?.find(item => item.date === overview.value.today.date))
const todayProgress = computed(() => overview.value?.dailyProgress?.find(item => item.date === overview.value.today.date))
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

async function loadDay() {
  const [todayRes, meRes] = await Promise.all([fetch('/api/today'), fetch('/api/me')])
  if (todayRes.ok) day.value = await todayRes.json()
  if (meRes.ok) me.value = (await meRes.json()).user || null
}
async function toggleSubscribe() {
  const path = isSubscribed.value ? '/api/unsubscribe' : '/api/subscribe'
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
  const result = await response.json()
  if (response.ok) me.value = { ...me.value, subscriptions: result.subscriptions || [] }
  else { message.value = result.error || '操作失败，请稍后重试。'; modal.value = true }
}
function openAuth() { message.value = ''; modal.value = true }
async function submitAuth() {
  pending.value = true
  try {
    const response = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form.value) })
    const result = await response.json()
    if (!response.ok) message.value = result.error || '操作失败，请稍后重试。'
    else message.value = result.message
  } finally { pending.value = false }
}
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
  const email = settings.value.email
  emailForm.value = { apiKey: email.apiKey || '', from: email.from || '', enabled: email.enabled !== false }
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
async function saveEmailSettings() {
  emailSaveMessage.value = '保存中…'
  const response = await api('/api/admin/settings/email', { method: 'PUT', body: JSON.stringify(emailForm.value) })
  const result = await response.json()
  emailSaveMessage.value = response.ok ? '邮件配置已保存' : (result.error || '保存失败')
  if (response.ok) await loadSettings()
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
async function sendDaily() { const r = await api('/api/admin/send-daily', { method: 'POST' }); const d = await r.json().catch(() => ({})); flashMessage(r.ok ? `已发送今日日报（${d.recipients ?? 0} 位订阅用户）` : (d.error || '发送失败')); await loadOverview() }
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
  } else await loadDay()
})
</script>

<template>
  <div v-if="!isAdmin" class="app-shell">
    <header class="nav"><a class="logo" href="/">行情日报<span>DAILY MARKET NOTE</span></a><nav><a href="#today">今日复盘</a><a href="#how">怎么工作</a><template v-if="me"><span class="nav-email">{{ me.email }}</span><button v-if="isSubscribed" type="button" class="ghost small" @click="toggleSubscribe">退阅</button><button v-else type="button" class="ghost small" @click="toggleSubscribe">重新订阅</button></template><button v-else class="primary small" @click="openAuth">免费订阅</button></nav></header>
    <main>
      <section class="hero"><div class="hero-copy"><p class="kicker">每天 15:46 · 邮箱送达</p><h1>把收盘后的<br><em>市场脉搏</em> 发到你手上。</h1><p class="lede">一封清晰、克制、可验证的 A 股复盘。看懂主线、情绪和明日观察点。</p><div class="actions"><button class="primary" @click="openAuth">免费订阅每日行情 →</button><a class="text-link" href="#today">{{ nothingReady ? '先看今天的报告' : '先看最新报告' }}</a></div></div><div class="hero-card"><div class="card-top"><span>{{ display.date }}</span><span class="live">● {{ isShowingPrevious ? '上一交易日' : (ready ? '已更新' : '准备中') }}</span></div><div class="temperature"><small>市场温度</small><strong>{{ analysis.temperature != null ? analysis.temperature + '°' : '--' }}</strong><b>{{ isShowingPrevious ? '展示上一交易日报告' : (ready ? '收盘分析已完成' : '等待外部分析报告上传') }}</b></div><div class="signal"><span>主线</span><strong>{{ display.analysisStatus === 'analyzed' ? (analysis.title || '今日复盘') : '今日行情分析准备中' }}</strong><small>{{ display.analysisStatus === 'analyzed' ? analysis.summary : '报告上传后，首页将自动更新' }}</small></div></div></section>
      <section v-if="display.analysisStatus === 'analyzed' && marketBand" id="market" class="market-band"><div v-if="indices.length" class="band-block"><p class="band-label">主要指数</p><div class="index-strip"><div v-for="ix in indices" :key="ix.name" class="index-chip"><span>{{ ix.name }}</span><b :class="signed(ix.change)">{{ ix.change || '--' }}</b><small v-if="ix.value">{{ ix.value }}</small></div></div></div><div v-if="breadthStats.length" class="band-block"><p class="band-label">市场广度</p><div class="breadth-grid"><div v-for="cell in breadthStats" :key="cell.label" class="breadth-cell"><small>{{ cell.label }}</small><b :class="cell.cls">{{ cell.value }}</b></div></div></div><div v-if="mainline.length" class="band-block"><p class="band-label">主线方向</p><div class="chip-row"><span v-for="m in mainline" :key="m" class="chip">{{ m }}</span></div></div><div v-if="leadingStocks.length" class="band-block"><p class="band-label">连板梯队</p><div class="ladder-row"><div v-for="(stock, i) in leadingStocks" :key="i" class="ladder-card" :class="{ top: i === 0 }"><b>{{ stock.level }}</b><strong>{{ stock.name }}</strong><small>{{ stock.sector || '' }}</small></div></div></div><div v-if="nextFocus.length" class="band-block"><p class="band-label">明日观察</p><ul class="focus-list"><li v-for="f in nextFocus" :key="f">{{ f }}</li></ul></div></section>
      <section id="today" class="section"><div class="section-heading"><p class="kicker">TODAY'S NOTE</p><h2>{{ display.date }}，市场在交易什么？</h2></div><div v-if="!ready" class="waiting-panel" role="status" aria-live="polite"><span class="waiting-dot"></span><div><strong>今日行情报告生成中</strong><p>外部分析服务正在排版当日收盘复盘，通常需要几分钟。报告完成后此处将自动展示，请耐心等待。</p></div></div><p v-if="isShowingPrevious" class="prev-note">今日报告尚未生成，先展示上一交易日（{{ display.date }}）的复盘。</p><div class="report-preview"><h3>{{ display.analysisStatus === 'analyzed' ? (analysis.title || '市场主线观察') : '等待外部分析报告上传，自动生成今日复盘。' }}</h3><p>{{ display.analysisStatus === 'analyzed' ? analysis.summary : '每日行情由外部分析服务上传报告后自动更新。' }}</p><a class="report-link" :href="display.reportPath || '#'">{{ display.analysisStatus === 'analyzed' ? '阅读完整 HTML 报告 →' : '等待今日报告生成' }}</a></div></section>
      <section id="how" class="how section"><div class="section-heading"><p class="kicker">HOW IT WORKS</p><h2>三步开始你的每日复盘</h2></div><div class="steps"><div><b>1</b><h3>邮箱注册</h3><p>验证邮箱，建立你的专属订阅。</p></div><div><b>2</b><h3>选择产品</h3><p>先从每日行情开始。</p></div><div><b>3</b><h3>每天收到</h3><p>固定时间打开市场简报。</p></div></div></section>
    </main>
    <div v-if="modal" class="modal show" @click.self="modal = false"><div class="modal-card"><button class="close" @click="modal = false">×</button><h2 class="auth-title">订阅每日行情</h2><p class="auth-copy">填写邮箱后，我们会发送验证邮件。完成验证即可开始接收日报。</p><div v-if="message" class="alert" role="status" aria-live="polite">{{ message }}</div><form class="auth-form" @submit.prevent="submitAuth"><label>邮箱<input v-model.trim="form.email" type="email" autocomplete="email" required></label><button class="primary" :disabled="pending">{{ pending ? '发送中…' : '发送验证邮件' }}</button></form></div></div>
  </div>

  <div v-else class="admin-body">
    <header class="nav"><a class="logo" href="/">行情日报<span>ADMIN CONSOLE</span></a><nav><a href="/">返回首页</a></nav></header>
    <main class="admin-shell">
      <section v-if="adminSessionPending" class="admin-loading" role="status" aria-live="polite">正在验证后台会话…</section>
      <section v-else-if="!overview" class="admin-gate"><p class="gate-mark">SECURE ADMIN</p><h1>进入行情日报后台</h1><p>请输入后台授权密码。</p><label>授权密码<input v-model="gateKey" type="password" @keyup.enter="unlock"></label><button class="primary" @click="unlock">验证并进入</button><p class="gate-error">{{ gateError }}</p></section>
      <template v-else><aside class="admin-sidebar"><h2>行情日报</h2><small>OPERATIONS DESK</small><nav><a href="/admin/today" :class="{active: activeSection === 'today'}">今日状态</a><a href="/admin/report-upload" :class="{active: activeSection === 'report-upload'}">报告上传</a><a href="/admin/reports" :class="{active: activeSection === 'reports'}">每日报告</a><a href="/admin/analysis" :class="{active: activeSection === 'analysis'}">分析任务</a><a href="/admin/progress" :class="{active: activeSection === 'progress'}">发送进度</a><a href="/admin/users" :class="{active: activeSection === 'users'}">订阅用户</a><a href="/admin/ai" :class="{active: activeSection === 'ai'}">AI 设置</a><a href="/admin/email" :class="{active: activeSection === 'email'}">邮件设置</a><a href="/admin/api-manual" :class="{active: activeSection === 'api-manual'}">API 对接手册</a></nav><div class="side-status">授权状态<br><strong>已验证会话</strong></div></aside><section class="admin-content"><div class="admin-head"><div><p class="kicker">OPERATIONS</p><h1>行情日报后台</h1><p>外部分析服务上传当日报告后，即可预览并推送订阅邮件。</p></div><button class="ghost" @click="loadOverview">↻ 刷新数据</button></div><p v-if="adminMessage" class="toast" role="status" aria-live="polite">{{ adminMessage }}</p>
        <div v-if="activeSection === 'today'" class="admin-page"><section class="panel"><div class="page-title"><div><h2>今日行情分析</h2><p class="today-date">{{ overview.today.date }}</p></div><span class="status" :class="overview.today.analysisStatus === 'analyzed' ? 'ready' : ''">{{ overview.today.analysisStatus === 'analyzed' ? '报告已生成' : '报告未生成' }}</span></div><div class="stats today-stats"><div class="stat"><small>AI 渲染</small><b><span v-if="renderStatus === 'running'" class="task-spinner" aria-hidden="true"></span>{{ renderStatusText(renderStatus) }}</b></div><div class="stat"><small>已发送邮件</small><b>{{ todayProgress?.sent || 0 }} 个</b></div><div class="stat"><small>应发送</small><b>{{ todayProgress?.expected || 0 }}</b></div></div><div class="stats"><div class="stat"><small>发送失败</small><b>{{ todayProgress?.failed || 0 }}</b></div><div class="stat"><small>待发送</small><b>{{ todayProgress?.pending || 0 }}</b></div></div><div class="admin-actions"><button class="primary" :disabled="overview.today.analysisStatus !== 'analyzed'" @click="sendDaily">发送今日日报</button></div></section></div>
        <div v-else-if="activeSection === 'reports'" class="admin-page report-page"><section class="panel"><div class="page-title"><div><h2>每日报告</h2><p>最近 60 个交易日，按日期从新到旧排列。可对已生成报告重新生成，或重置后重新上传。</p></div><span class="page-count">{{ reportItems.length }} 个交易日</span></div><div class="report-grid"><div v-for="item in pagedReports" :key="item.date" class="report-card"><div class="report-card-head"><strong>{{ item.date }}</strong><span v-if="item.analysis?.temperature != null" class="report-temp">{{ item.analysis.temperature }}°</span></div><div class="report-badges"><span class="status" :class="item.analysisStatus === 'analyzed' ? 'ready' : ''">{{ item.analysisStatus === 'analyzed' ? '已生成' : '待生成' }}</span><span class="status" :class="item.sendStatus === 'sent' ? 'ready' : item.sendStatus === 'failed' ? 'fail' : ''">{{ item.sendStatus === 'sent' ? '已发送' : item.sendStatus === 'failed' ? '失败' : '未发送' }}</span><span v-if="item.renderStatus === 'running'" class="status"><span class="task-spinner" aria-hidden="true"></span>渲染中</span><span v-else-if="item.renderStatus === 'failed'" class="status fail">渲染失败</span></div><p v-if="item.analysis?.summary" class="report-row-summary">{{ item.analysis.summary }}</p><div class="report-card-actions"><a v-if="item.reportPath" :href="item.reportPath" target="_blank" rel="noreferrer">查看报告 ↗</a><button v-if="item.analysisStatus === 'analyzed'" type="button" class="report-reset" @click="regenerateReport(item)">重新生成</button><button type="button" class="report-reset" @click="resetReport(item)">重置</button></div></div></div><p v-if="!pagedReports.length" class="notice">暂无交易日报记录。</p><div class="pagination"><button type="button" :disabled="reportPage === 1" @click="changeReportPage(reportPage - 1)">上一页</button><button v-for="page in reportPages" :key="page" type="button" :class="{current: reportPage === page}" @click="changeReportPage(page)">{{ page }}</button><button type="button" :disabled="reportPage === reportPages" @click="changeReportPage(reportPage + 1)">下一页</button></div></section></div>
        <div v-else-if="activeSection === 'analysis'" class="admin-page"><section class="panel"><h2>分析任务</h2><div class="table-wrap"><table class="admin-table"><thead><tr><th>交易日</th><th>触发方式</th><th>状态</th><th>开始时间</th><th>完成时间</th></tr></thead><tbody><tr v-for="item in overview.analysisTasks" :key="item.date"><td>{{ item.date }}</td><td>{{ item.trigger === 'upload' ? '外部分析上传' : item.trigger === 'manual' ? '后台重新生成' : (item.trigger || '-') }}</td><td><span class="task-status" :class="item.status"><span v-if="item.status === 'running'" class="task-spinner" aria-hidden="true"></span>{{ item.status === 'running' ? '生成中' : item.status === 'completed' ? '已完成' : item.status === 'failed' ? '失败' : '等待中' }}</span></td><td>{{ formatTime(item.startedAt) }}</td><td>{{ formatTime(item.completedAt) }}</td></tr><tr v-if="!overview.analysisTasks?.length"><td colspan="5" class="empty-cell">暂无分析任务。</td></tr></tbody></table></div></section></div>
        <div v-else-if="activeSection === 'progress'" class="admin-page"><section class="panel"><h2>每日发送进度</h2><div class="table-wrap"><table class="admin-table"><thead><tr><th>交易日</th><th>分析</th><th>应发送</th><th>已发送</th><th>失败</th><th>待发送</th><th>完成率</th></tr></thead><tbody><tr v-for="item in overview.dailyProgress" :key="item.date"><td>{{ item.date }}</td><td>{{ analysisStatusText(item.analysisStatus) }}</td><td>{{ item.expected }}</td><td>{{ item.sent }}</td><td>{{ item.failed }}</td><td>{{ item.pending }}</td><td><div class="rate-cell"><div class="progress-bar"><span :style="{ width: (item.expected ? Math.round(item.sent / item.expected * 100) : 0) + '%' }"></span></div><b>{{ item.expected ? Math.round(item.sent / item.expected * 100) : 0 }}%</b></div></td></tr><tr v-if="!overview.dailyProgress?.length"><td colspan="7" class="empty-cell">暂无发送记录。</td></tr></tbody></table></div></section></div>
        <div v-else-if="activeSection === 'users'" class="admin-page"><section class="panel"><div class="page-title"><div><h2>订阅用户</h2><p>共 {{ userStats.total }} 位注册用户，{{ userStats.verified }} 已验证，{{ userStats.pending }} 待验证。</p></div><span class="page-count">显示 {{ pagedUsers.length }} / {{ filteredUsers.length }}</span></div><div class="table-toolbar"><input v-model.trim="userSearch" type="search" placeholder="按邮箱搜索…" aria-label="搜索订阅用户"></div><div class="table-wrap"><table class="admin-table"><thead><tr><th>邮箱</th><th>验证状态</th><th>注册时间</th></tr></thead><tbody><tr v-for="user in pagedUsers" :key="user.id"><td>{{ user.email }}</td><td>{{ user.verified ? '已验证' : '待验证' }}</td><td>{{ formatTime(user.createdAt) }}</td></tr><tr v-if="!pagedUsers.length"><td colspan="3" class="empty-cell">暂无订阅用户{{ userSearch ? '（无匹配结果）' : '' }}。</td></tr></tbody></table></div><div v-if="userPages > 1" class="pagination"><button type="button" :disabled="userPage === 1" @click="changeUserPage(userPage - 1)">上一页</button><button v-for="page in userPages" :key="page" type="button" :class="{current: userPage === page}" @click="changeUserPage(page)">{{ page }}</button><button type="button" :disabled="userPage === userPages" @click="changeUserPage(userPage + 1)">下一页</button></div></section></div>
        <div v-else-if="activeSection === 'ai'" class="admin-page settings-page"><section class="panel"><div class="page-title"><div><h2>AI 设置</h2><p>配置用于把行情 Markdown 排版为精美 HTML 报告的 GPT 或 Claude 模型服务。AI 从零设计排版并提炼首页数据（温度、指数、广度、主线等）；未配置或调用失败时回退基础渲染。</p></div><span class="status" :class="{ready: settings?.ai?.apiKeyMasked}">{{ settings?.ai?.apiKeyMasked ? '已配置' : '未配置' }}</span></div><div class="settings-summary"><div><small>服务商</small><strong>{{ settings?.ai?.provider || 'OpenAI Compatible' }}</strong></div><div><small>当前模型</small><strong>{{ settings?.ai?.model || '未设置' }}</strong></div><div><small>调用协议</small><strong>{{ settings?.ai?.protocol === 'anthropic_messages' ? 'Claude Messages API' : 'GPT Responses API' }}</strong></div></div><form class="settings-form" @submit.prevent="saveAiSettings"><div class="settings-grid"><label>服务商名称<input v-model.trim="aiForm.provider" maxlength="80" required></label><label>接口格式<select v-model="aiForm.protocol"><option value="openai_responses">GPT Responses API</option><option value="anthropic_messages">Claude Messages API</option></select></label><label>模型 ID<input v-model.trim="aiForm.model" maxlength="200" required placeholder="例如 gpt-5.6-luna 或 claude-sonnet-4-5"></label><label>接口超时（秒）<input v-model.number="aiForm.timeoutSeconds" type="number" min="30" max="3600" required></label><label class="settings-span-2">Base URL<input v-model.trim="aiForm.baseUrl" type="url" placeholder="https://api.openai.com/v1 或 https://api.anthropic.com/v1"></label><label class="settings-span-2">API Key<span class="secret-input"><input v-model.trim="aiForm.apiKey" :type="aiKeyVisible ? 'text' : 'password'" autocomplete="new-password" placeholder="输入 API Key"><button type="button" class="secret-toggle" :aria-label="aiKeyVisible ? '隐藏 AI API Key' : '显示 AI API Key'" :aria-pressed="aiKeyVisible" @click="aiKeyVisible = !aiKeyVisible">{{ aiKeyVisible ? '隐藏' : '显示' }}</button></span></label></div><div class="settings-switches"><label><input v-model="aiForm.enabled" type="checkbox"> 启用 AI 排版（未启用或调用失败时回退到默认渲染）</label></div><div class="settings-actions"><button type="button" :disabled="aiTesting" @click="testAiSettings">{{ aiTesting ? '检测中…' : '检测连接' }}</button><button class="primary" type="submit">保存 AI 配置</button><span role="status" aria-live="polite">{{ aiSaveMessage }}</span></div></form></section></div>
        <div v-else-if="activeSection === 'email'" class="admin-page settings-page"><section class="panel"><div class="page-title"><div><h2>邮件设置</h2><p>配置日报、验证邮件和手动推送使用的 Resend 服务。</p></div><span class="status" :class="{ready: settings?.email?.apiKeyMasked}">{{ settings?.email?.apiKeyMasked ? '已配置' : '未配置' }}</span></div><div class="settings-summary"><div><small>邮件服务</small><strong>Resend</strong></div><div><small>发件人</small><strong>{{ settings?.email?.from || '未设置' }}</strong></div><div><small>密钥状态</small><strong>{{ settings?.email?.apiKeyMasked || '未设置' }}</strong></div></div><form class="settings-form" @submit.prevent="saveEmailSettings"><div class="settings-grid"><label class="settings-span-2">Resend API Key<span class="secret-input"><input v-model.trim="emailForm.apiKey" :type="emailKeyVisible ? 'text' : 'password'" autocomplete="new-password" placeholder="输入 re_ 开头的密钥"><button type="button" class="secret-toggle" :aria-label="emailKeyVisible ? '隐藏 Resend API Key' : '显示 Resend API Key'" :aria-pressed="emailKeyVisible" @click="emailKeyVisible = !emailKeyVisible">{{ emailKeyVisible ? '隐藏' : '显示' }}</button></span></label><label class="settings-span-2">发件人地址<input v-model.trim="emailForm.from" type="text" maxlength="200" placeholder="行情日报 <reports@example.com>"></label></div><div class="settings-switches"><label><input v-model="emailForm.enabled" type="checkbox"> 启用真实邮件发送</label></div><div class="settings-actions"><button class="primary" type="submit">保存邮件配置</button><span role="status" aria-live="polite">{{ emailSaveMessage }}</span></div></form></section></div>
        <div v-else-if="activeSection === 'report-upload'" class="admin-page settings-page"><section class="panel"><div class="page-title"><div><h2>报告上传</h2><p>手动保存当日行情报告的 Markdown，与外部接口上传共用同一处理机制：渲染 HTML、标记为已分析、可推送订阅邮件。</p></div><span class="status" :class="{ready: overview.today.analysisStatus === 'analyzed'}">{{ overview.today.analysisStatus === 'analyzed' ? '今日报告已生成' : '今日报告未生成' }}</span></div><form class="settings-form" @submit.prevent="saveReport"><div class="settings-grid"><label>交易日<input v-model.trim="reportUploadForm.date" type="date" required></label></div><div class="skill-editor"><div class="editor-head"><h3>报告 Markdown</h3><span role="status" aria-live="polite">{{ reportUploadMessage }}</span></div><textarea v-model="reportUploadForm.markdown" spellcheck="false" placeholder="# A股收盘复盘&#10;&#10;正文…（支持 YAML frontmatter 的 title / summary）" aria-label="报告 Markdown 内容"></textarea><button class="primary" :disabled="reportUploading" type="submit">{{ reportUploading ? '保存中…' : '保存并生成报告' }}</button></div></form></section></div>
        <div v-else-if="activeSection === 'api-manual'" class="admin-page settings-page"><section class="panel"><div class="page-title"><div><h2>API 对接手册</h2><p>上传每日行情（报告 MD）接口对接说明。下方为真实接入信息与完整对接文本，复制后可直接给外部分析服务或 AI 工具使用；上传密钥请妥善保管。</p></div><button class="ghost refresh-button" type="button" @click="loadApiManual">↻ 刷新</button></div><div class="settings-summary api-cred"><div><small>Base URL</small><strong>{{ apiBaseUrl || '—' }}</strong><button class="manual-copy" type="button" @click="copyText(apiBaseUrl, 'base')">{{ copiedKey === 'base' ? '已复制 ✓' : '复制' }}</button></div><div><small>上传密钥 · x-upload-key</small><strong><span class="secret-input"><input :type="manualUploadVisible ? 'text' : 'password'" :value="apiUploadKey || '—'" readonly aria-label="上传密钥"><button type="button" class="secret-toggle" :aria-label="manualUploadVisible ? '隐藏上传密钥' : '显示上传密钥'" :aria-pressed="manualUploadVisible" @click="manualUploadVisible = !manualUploadVisible">{{ manualUploadVisible ? '隐藏' : '显示' }}</button></span></strong><button class="manual-copy" type="button" @click="copyText(apiUploadKey, 'upload')">{{ copiedKey === 'upload' ? '已复制 ✓' : '复制' }}</button></div></div><div class="settings-actions" style="justify-content:space-between"><span role="status" aria-live="polite">{{ apiManualLoading ? '正在加载对接文本…' : (apiManual ? '已加载完整对接文本（含真实密钥）。' : '') }}</span><button class="primary" type="button" :disabled="apiManualLoading" @click="copyText(apiManual, 'full')">{{ copiedKey === 'full' ? '已复制全文 ✓' : '复制全文（含真实密钥）' }}</button></div><pre v-if="apiManual" class="manual-pre">{{ apiManual }}</pre><p v-else class="notice">正在加载对接手册…</p></section></div>
      </section></template>
    </main>
  </div>
</template>
