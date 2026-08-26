<script setup>
const downloads = {
  x64: 'https://github.com/rjf1979/review_stock/releases/download/v0.2.3/hangqing-desktop-0.2.3-win-x64-setup.exe',
  ia32: 'https://github.com/rjf1979/review_stock/releases/download/v0.2.3/hangqing-desktop-0.2.3-win-ia32-setup.exe',
  release: 'https://github.com/rjf1979/review_stock/releases/tag/v0.2.3'
}
</script>

<template>
  <div class="app-shell">
    <header class="nav">
      <a class="logo" href="#top" aria-label="返回行情日报首页">行情日报<span>DESKTOP MARKET DESK</span></a>
      <nav aria-label="主导航">
        <a href="#features">功能</a>
        <a href="#how">工作方式</a>
        <a href="#download">下载</a>
      </nav>
    </header>

    <main>
      <section id="top" class="site-hero">
        <div class="hero-copy">
          <p class="kicker">LOCAL MARKET DESK · WINDOWS DESKTOP</p>
          <h1>行情日报，<br><em>一屏看懂。</em></h1>
          <p class="lede">实时行情、板块、龙虎榜和收盘复盘。数据在你的电脑本地整理，打开应用就能开始工作。</p>
          <div class="actions">
            <a class="primary" :href="downloads.x64">下载 Windows 64 位版</a>
            <a class="text-link" href="#features">查看功能</a>
          </div>
          <p class="fine">Windows 10/11 · x64 与 32 位 · 免费 · 无需账号</p>
        </div>

        <div class="hero-console" aria-label="行情日报桌面版功能预览">
          <div class="console-bar"><span class="console-brand"><i aria-hidden="true"></i> 行情日报</span><span class="console-caption">DESKTOP APP</span><span class="console-status">本地运行</span></div>
          <div class="console-content">
            <div class="console-heading"><div><small>MARKET DESK / FEATURES</small><strong>收盘后的工作台</strong></div><span class="console-refresh">无需登录</span></div>
            <div class="console-indices">
              <div class="console-index"><small>实时行情</small><strong>本地更新</strong><span>指数与自选股</span></div>
              <div class="console-index"><small>每日复盘</small><strong>16:00</strong><span>工作日整理</span></div>
              <div class="console-index"><small>系统通知</small><strong>可选</strong><span>托盘运行</span></div>
            </div>
            <div class="console-table"><div><span>数据来源</span><b>腾讯行情 · 东方财富</b></div><div><span>运行方式</span><b>本地直连公开接口</b></div><div><span>数据保存</span><b>当前 Windows 用户本地</b></div></div>
          </div>
        </div>
      </section>

      <section id="features" class="feature-section">
        <div class="section-heading"><p class="kicker">DESKTOP FEATURES</p><h2>为每天收盘后的十分钟设计</h2><p>把需要反复打开的行情入口，收拢成一张安静、可扫描的桌面工作台。</p></div>
        <div class="feature-grid">
          <article><span class="feature-index">01</span><h3>实时行情</h3><p>A 股指数与自选股实时报价，刷新频率可调，涨跌语义清晰。</p></article>
          <article><span class="feature-index">02</span><h3>每日复盘</h3><p>市场温度、大盘概览、资金流、海外市场和要闻集中呈现。</p></article>
          <article><span class="feature-index">03</span><h3>板块与龙虎榜</h3><p>领涨板块、涨停连板梯队和龙虎榜净买入，收盘后一次看完。</p></article>
          <article><span class="feature-index">04</span><h3>本地数据</h3><p>公开行情在本机整理，自选股、设置和复盘记录保存在本地。</p></article>
        </div>
      </section>

      <section id="how" class="how section">
        <div class="section-heading"><p class="kicker">HOW IT WORKS</p><h2>从数据到桌面，只需三步</h2></div>
        <div class="steps">
          <div><b>01</b><h3>安装桌面版</h3><p>下载对应架构的 Windows 安装包，按向导完成安装。</p></div>
          <div><b>02</b><h3>本地抓取行情</h3><p>应用直接读取公开行情源，在本机整理实时数据。</p></div>
          <div><b>03</b><h3>收盘后查看</h3><p>打开工作台查看盘面、异动、自选和每日复盘。</p></div>
        </div>
      </section>

      <section id="download" class="download-section">
        <div><p class="kicker">DESKTOP RELEASE · V0.2.3</p><h2>把行情日报放在桌面上</h2><p>当前提供 Windows x64 和 32 位安装包，仅限个人非商业使用。安装包未进行代码签名，请从 GitHub Release 页面下载并核对 SHA-256。</p></div>
        <div class="download-options">
          <a class="download-option" :href="downloads.x64"><span>Windows x64</span><strong>下载安装包</strong><small>适用于绝大多数 Windows 10/11 电脑</small></a>
          <a class="download-option" :href="downloads.ia32"><span>Windows 32 位</span><strong>下载安装包</strong><small>仅用于 32 位 Windows</small></a>
          <a class="download-option future" href="#future-app"><span>未来 App 版</span><strong>规划中</strong><small>移动端工程尚未开始</small></a>
          <a class="release-link" :href="downloads.release">查看 Release 与校验值</a>
        </div>
      </section>

      <section id="future-app" class="future-section section">
        <div class="section-heading"><p class="kicker">FUTURE APP</p><h2>未来再延伸到移动端</h2><p>移动端目前只是工程占位，后续将单独设计数据访问、同步、离线和通知策略，不直接依赖 Electron 桌面端。</p></div>
      </section>

      <section id="data" class="compliance-section section">
        <div class="section-heading"><p class="kicker">DATA &amp; DISCLAIMER</p><h2>数据从哪里来？</h2></div>
        <div class="compliance-grid"><div><h3>公开来源，本地整理</h3><p>行情日报使用腾讯行情、东方财富等公开免费数据源。桌面版在本地取数和整理，不采集你的交易信息，也不经过平台服务器中转。</p></div><div><h3>免责声明</h3><p>行情日报仅提供行情数据的展示与整理，所有数据来自公开来源，仅供参考，不构成任何投资建议。股市有风险，投资需谨慎。</p></div></div>
      </section>
    </main>

    <footer><span>© 2026 行情日报 · Desktop Market Desk</span><span><a href="#data">数据来源与免责声明</a> · <a href="#download">下载</a></span></footer>
  </div>
</template>
