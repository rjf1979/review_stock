<script setup>
import { ref } from 'vue'
import realtimeImage from './assets/desktop-screens/realtime.png'
import watchlistImage from './assets/desktop-screens/watchlist.png'
import dailyReviewImage from './assets/desktop-screens/daily-review.png'
import dragonTigerImage from './assets/desktop-screens/dragon-tiger.png'

const downloads = {
  x64: 'https://oss.askcode.cn/files/hangqing-desktop-0.3.5-win-x64-setup.exe',
  ia32: 'https://oss.askcode.cn/files/hangqing-desktop-0.3.5-win-ia32-setup.exe',
  x64Backup: 'https://github.com/rjf1979/review_stock/releases/download/v0.3.5/hangqing-desktop-0.3.5-win-x64-setup.exe',
  ia32Backup: 'https://github.com/rjf1979/review_stock/releases/download/v0.3.5/hangqing-desktop-0.3.5-win-ia32-setup.exe',
  x64Backup2: 'https://my-soft-2026.oss-cn-shanghai.aliyuncs.com/files/hangqing-desktop-0.3.5-win-x64-setup.exe',
  ia32Backup2: 'https://my-soft-2026.oss-cn-shanghai.aliyuncs.com/files/hangqing-desktop-0.3.5-win-ia32-setup.exe',
  release: 'https://github.com/rjf1979/review_stock/releases/tag/v0.3.5'
}

const activeImage = ref(null)
function openImage(src, alt) {
  activeImage.value = { src, alt }
}
</script>

<template>
  <div class="app-shell">
    <header class="nav">
      <a class="logo" href="#top" aria-label="返回股市脉搏首页">股市脉搏<span>DESKTOP MARKET DESK</span></a>
      <nav aria-label="主导航">
        <a href="#features">功能</a>
        <a href="#pages">页面</a>
        <a href="#how">工作方式</a>
        <a href="#download">下载</a>
      </nav>
    </header>

    <main>
      <section id="top" class="site-hero">
        <div class="hero-copy">
          <p class="kicker">LOCAL MARKET DESK · WINDOWS DESKTOP</p>
          <h1>股市脉搏，<br><em>一屏看懂。</em></h1>
          <p class="lede">实时行情、板块、龙虎榜和收盘复盘。数据在你的电脑本地整理，打开应用就能开始工作。</p>
          <div class="actions">
            <a class="primary" :href="downloads.x64">下载 Windows 64 位版</a>
            <a class="text-link" href="#features">查看功能</a>
          </div>
          <p class="fine">Windows 10/11 · 提供 x64 与 x86 安装包 · macOS 暂未提供 · 免费 · 无需账号</p>
        </div>

        <div class="hero-console" aria-label="股市脉搏桌面版功能预览">
          <div class="console-bar"><span class="console-brand"><i aria-hidden="true"></i> 股市脉搏</span><span class="console-caption">DESKTOP APP</span><span class="console-status">本地运行</span></div>
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
        <div class="section-heading"><p class="kicker">DESKTOP FEATURES</p><h2>为每天收盘后的十分钟设计</h2><p>把需要反复打开的行情入口，收拢成一张安静、可扫描的桌面工作台。从盘中观察到收盘复盘，每个页面都围绕一个明确任务展开。</p></div>
        <div class="feature-grid">
          <article><span class="feature-index">01</span><h3>实时行情</h3><p>A 股指数、市场宽度、涨跌停、行业资金、涨跌榜和盘口异动集中显示，交易时段自动刷新。</p></article>
          <article><span class="feature-index">02</span><h3>自选股工作区</h3><p>保存常看股票，查看最新报价、涨跌幅与日 K 走势，还能把股票即时加入浮动监控。</p></article>
          <article><span class="feature-index">03</span><h3>每日复盘</h3><p>用市场温度、情绪指标、指数结构、主线排序、连板高度和数据质量核对还原收盘状态。</p></article>
          <article><span class="feature-index">04</span><h3>龙虎榜联动</h3><p>展开买卖前五席位，查看净买入与上榜原因，并将关注股票直接加入自选股。</p></article>
        </div>
      </section>

      <section id="pages" class="product-pages section">
        <div class="section-heading"><p class="kicker">INSIDE THE DESK</p><h2>每个页面，解决一个观察问题</h2><p>下面是桌面版的真实界面。数据来自应用实际页面，帮助你在下载安装前了解工作方式。</p></div>
        <div class="page-showcase">
          <article class="page-feature">
            <figure><button type="button" class="page-shot" aria-label="查看实时行情页面原图" @click="openImage(realtimeImage, '股市脉搏实时行情页面，展示指数、市场宽度、资金流和涨跌榜')"><img :src="realtimeImage" alt="股市脉搏实时行情页面，展示指数、市场宽度、资金流和涨跌榜" loading="lazy"></button><figcaption>实时行情 · 点击查看原图</figcaption></figure>
            <div class="page-copy"><span class="feature-index">01 / REALTIME</span><h3>先判断今天的市场状态</h3><p>打开应用先看到市场雷达：主要指数、全市场涨跌家数、涨停跌停、行业主力资金、涨跌幅榜和盘口异动位于同一工作区。</p><ul><li>交易时段自动刷新，闭市后保留最近有效数据</li><li>盘面异常与数据日期清晰标注</li><li>顶部菜单固定，内容区域独立滚动</li></ul></div>
          </article>
          <article class="page-feature reverse">
            <figure><button type="button" class="page-shot" aria-label="查看自选股页面原图" @click="openImage(watchlistImage, '股市脉搏自选股页面，展示自选股票报价和日 K 走势')"><img :src="watchlistImage" alt="股市脉搏自选股页面，展示自选股票报价和日 K 走势" loading="lazy"></button><figcaption>自选股 · 点击查看原图</figcaption></figure>
            <div class="page-copy"><span class="feature-index">02 / WATCHLIST</span><h3>把关注的股票放在一起</h3><p>自选股页面把常看标的整理成可扫描的行情卡，报价、涨跌幅、数据时间和日 K 图一屏可见。</p><ul><li>支持添加、删除和从龙虎榜直接加入</li><li>自选股卡片可直接开启浮窗监控</li><li>本地保存，不需要注册账号</li></ul></div>
          </article>
          <article class="page-feature">
            <figure><button type="button" class="page-shot" aria-label="查看每日复盘页面原图" @click="openImage(dailyReviewImage, '股市脉搏每日复盘页面，展示市场温度、情绪指标和行业资金')"><img :src="dailyReviewImage" alt="股市脉搏每日复盘页面，展示市场温度、情绪指标和行业资金" loading="lazy"></button><figcaption>每日复盘 · 点击查看原图</figcaption></figure>
            <div class="page-copy"><span class="feature-index">03 / DAILY REVIEW</span><h3>把收盘后的信息整理成结论</h3><p>每日复盘将分散的收盘数据放在固定结构中，先看温度与情绪，再看指数、行业资金、连板梯队和详细数据。</p><ul><li>市场温度与红盘率快速判断情绪</li><li>行业涨幅和主力净流入分栏呈现</li><li>数据质量核对，明确样本与统计口径</li></ul></div>
          </article>
          <article class="page-feature reverse">
            <figure><button type="button" class="page-shot" aria-label="查看龙虎榜页面原图" @click="openImage(dragonTigerImage, '股市脉搏龙虎榜页面，展示买卖席位和净额')"><img :src="dragonTigerImage" alt="股市脉搏龙虎榜页面，展示买卖席位和净额" loading="lazy"></button><figcaption>龙虎榜 · 点击查看原图</figcaption></figure>
            <div class="page-copy"><span class="feature-index">04 / DRAGON TIGER</span><h3>从上榜股票看到资金席位</h3><p>龙虎榜按股票展开买入、卖出和净额，进一步查看买卖前五席位；符合条件的股票可直接放入自选股。</p><ul><li>公开席位名称按机构或营业部展示</li><li>买卖金额与净额使用统一单位</li><li>支持展开与收起，减少页面干扰</li></ul></div>
          </article>
        </div>
      </section>

      <section id="how" class="how section">
        <div class="section-heading"><p class="kicker">HOW IT WORKS</p><h2>从数据到桌面，只需三步</h2><p>股市脉搏是本地优先的 Windows 工具，公开行情直接在电脑上整理。</p></div>
        <div class="steps">
          <div><b>01</b><h3>安装桌面版</h3><p>下载对应架构的 Windows 安装包，按向导完成安装。</p></div>
          <div><b>02</b><h3>本地抓取行情</h3><p>应用直接读取公开行情源，在本机整理实时数据。</p></div>
          <div><b>03</b><h3>收盘后查看</h3><p>打开工作台查看盘面、异动、自选和每日复盘。</p></div>
        </div>
      </section>

      <section id="download" class="download-section">
        <div><p class="kicker">DESKTOP RELEASE · V0.3.5</p><h2>把股市脉搏放在桌面上</h2><p>Windows 64 位与 32 位安装包现已提供。macOS 暂未提供。安装包未进行代码签名，下载后请核对 SHA-256。主下载走阿里云 OSS 加速，若失效可切换到 GitHub Release 或备用镜像。</p></div>
        <div class="download-options">
          <a class="download-option" :href="downloads.x64"><span>Windows 64 位 (x64)</span><strong>下载安装包</strong><small>适用于绝大多数 Windows 10/11 电脑</small></a>
          <a class="download-option" :href="downloads.ia32"><span>Windows 32 位 (x86)</span><strong>下载安装包</strong><small>仅用于 32 位 Windows</small></a>
          <div class="download-option unavailable" role="note"><span>macOS</span><strong>暂未提供</strong><small>当前仅支持 Windows</small></div>
          <p class="download-note">境内主下载经阿里云 OSS + CDN；海外或主源失效时可使用 <a :href="downloads.x64Backup">GitHub Release</a> 与 <a :href="downloads.x64Backup2">OSS 备用镜像</a>。</p>
        </div>
      </section>

      <section id="future-app" class="future-section section">
        <div class="section-heading"><p class="kicker">FUTURE APP</p><h2>未来再延伸到移动端</h2><p>移动端目前只是工程占位，后续将单独设计数据访问、同步、离线和通知策略，不直接依赖 Electron 桌面端。</p></div>
      </section>

      <section id="data" class="compliance-section section">
        <div class="section-heading"><p class="kicker">DATA &amp; DISCLAIMER</p><h2>数据从哪里来？</h2></div>
        <div class="compliance-grid"><div><h3>公开来源，本地整理</h3><p>股市脉搏使用腾讯行情、东方财富等公开免费数据源。桌面版在本地取数和整理，不采集你的交易信息，也不经过平台服务器中转。</p></div><div><h3>免责声明</h3><p>股市脉搏仅提供行情数据的展示与整理，所有数据来自公开来源，仅供参考，不构成任何投资建议。股市有风险，投资需谨慎。</p></div></div>
      </section>
    </main>

    <div v-if="activeImage" class="image-lightbox" role="dialog" aria-modal="true" :aria-label="activeImage.alt" @click.self="activeImage = null" @keydown.esc.window="activeImage = null">
      <div class="image-lightbox-content">
        <button type="button" class="image-lightbox-close" aria-label="关闭原图" @click="activeImage = null">×</button>
        <img :src="activeImage.src" :alt="activeImage.alt">
      </div>
    </div>

    <footer><span>© 2026 股市脉搏 · Desktop Market Desk</span><span><a href="#data">数据来源与免责声明</a> · <a href="#download">下载</a></span></footer>
  </div>
</template>
