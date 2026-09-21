<template>
    <!-- ══════════ 回测证据（只读） ══════════ -->
    <template v-if="mode==='backtest'">
      <nav class="backtest-tabs" role="tablist" aria-label="回测视图">
        <button
          v-for="t in TABS" :key="t.key" type="button" role="tab"
          :id="'bt-tab-' + t.key" :aria-selected="backtest.tab === t.key" :aria-controls="'bt-panel-' + t.key"
          @click="switchTab(t.key)"
        >{{ t.cn }}</button>
      </nav>

      <div v-if="backtest.loading" class="status loading" role="status" aria-live="polite">正在读取回测证据与概率模型…</div>
      <div v-else-if="backtest.error" class="status error" role="status" aria-live="polite">{{ backtest.error }}</div>

      <!-- ───── 概览 ───── -->
      <section v-if="backtest.tab === 'overview'" id="bt-panel-overview" role="tabpanel" aria-labelledby="bt-tab-overview" tabindex="0">
        <section class="panel" aria-label="回测证据概览">
          <div class="panel-head">
            <div class="panel-title">
              <h2>回测证据层</h2>
              <p class="summary">
                口径：{{ legText }}；股票池 {{ universeText }}。
                数据由 Python 侧写入 data/backtest.db 与 decision_model.json，本页只读，不下单。
                当前回测库已按 14:40 分时反推口径重建，旧的 14:30~14:55 口径明细与网格不再在库。
              </p>
            </div>
            <div class="backtest-actions">
              <span class="summary" role="status" aria-live="polite">{{ loadedText }}</span>
              <button class="btn" :disabled="backtest.loading" :aria-busy="backtest.loading" @click="load(true)">重新读取</button>
            </div>
          </div>

          <div class="market-stats">
            <div v-for="card in countCards" :key="card.key" class="stat">
              <span>{{ card.cn }}</span>
              <strong>{{ fmtCount(card.value) }}</strong>
            </div>
          </div>

          <p class="summary backtest-note">
            过抽样口径：分档统计与概率模型基于 2% 随机抽样（约 10.9 万笔，抽样基准 {{ fmtPct(model && model.baseSampleHit3Pct, 2) }}），
            全样本日线 ≥+3% 基准为 {{ fmtPct(model && model.baseFullHit3Pct, 2) }}；两者差异决定了锚定方式，实盘按当日真实基准锚定。
          </p>
        </section>

        <section class="panel" aria-label="回测批次清单">
          <div class="panel-head">
            <div class="panel-title">
              <h2>回测批次</h2>
              <p class="summary">点选批次可切换下「分档统计」的维度来源；时点网格与概率模型取自各自批次。</p>
            </div>
          </div>
          <div v-if="!runs.length" class="status empty" role="status" aria-live="polite">回测库中暂无批次记录（data/backtest.db 的 bt_run 为空）。</div>
          <template v-else>
            <div class="chips backtest-run-chips" role="group" aria-label="回测批次选择">
              <button
                v-for="r in runs" :key="r.runId" type="button" class="chip"
                :aria-pressed="Number(r.runId) === Number(backtest.runId)" @click="selectRun(r.runId)"
              >#{{ r.runId }} {{ r.runKey }}</button>
            </div>
            <div class="table-wrap">
              <table>
                <caption class="visually-hidden">回测批次清单</caption>
                <thead>
                  <tr>
                    <th scope="col">批次</th>
                    <th scope="col">批次键</th>
                    <th scope="col">引擎</th>
                    <th scope="col">买入</th>
                    <th scope="col">卖出窗口</th>
                    <th scope="col">入库笔数</th>
                    <th scope="col">股票池</th>
                    <th scope="col">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in runs" :key="r.runId">
                    <td class="num">#{{ r.runId }}</td>
                    <td>{{ r.runKey }}</td>
                    <td class="num">{{ r.engineVersion || '—' }}</td>
                    <td class="num">{{ fmtMinute(r.buyTime) }}</td>
                    <td class="num">{{ fmtMinute(r.sellTimeStart) }} ~ {{ fmtMinute(r.sellTimeEnd) }}</td>
                    <td class="num">{{ fmtCount(r.tradeCount) }}</td>
                    <td title="股票池过滤说明">{{ r.universeFilter || '—' }}</td>
                    <td class="num">{{ (r.createdAt || '').replace('T', ' ') || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </section>
      </section>

      <!-- ───── 概率模型 ───── -->
      <section v-if="backtest.tab === 'model'" id="bt-panel-model" role="tabpanel" aria-labelledby="bt-tab-model" tabindex="0">
        <section v-if="backtest.modelError" class="panel" aria-label="概率模型不可用">
          <div class="panel-head">
            <div class="panel-title">
              <h2>概率评分模型</h2>
              <p class="summary err">{{ backtest.modelError }}</p>
            </div>
          </div>
          <p class="summary">生成命令：<code>python tools\bt_decision_engine.py --fit --write-doc</code>。</p>
        </section>

        <template v-else-if="model">
          <section class="panel" aria-label="模型元信息与目标选择">
            <div class="panel-head">
              <div class="panel-title">
                <h2>概率评分模型</h2>
                <p class="summary">
                  批次 {{ model.runKey }} · 训练 {{ fmtCount(model.trainRows) }} 笔 · 区间
                  {{ fmtDate(model.dateRange && model.dateRange[0]) }} ~ {{ fmtDate(model.dateRange && model.dateRange[1]) }}
                  · 分档 {{ model.bins }} · λ {{ model.lambda }} · shrinkK {{ model.shrinkK }} · 生成 {{ fmtStamp(model.builtAt) }}
                </p>
              </div>
            </div>
            <div class="chips" role="group" aria-label="预测目标选择">
              <button
                v-for="t in targets" :key="t.key" type="button" class="chip"
                :aria-pressed="backtest.modelTarget === t.key" @click="selectTarget(t.key)"
              >{{ t.cn }}</button>
            </div>
          </section>

          <section class="panel" aria-label="目标区分度">
            <div class="panel-head">
              <div class="panel-title">
                <h2>区分度（留一年验证）</h2>
                <p class="summary">AUC 越接近 0.5 越接近随机；分年 AUC 是逐年留出验证，不是样本内拟合。</p>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <caption class="visually-hidden">各预测目标的 AUC 与基准命中率</caption>
                <thead>
                  <tr>
                    <th scope="col">目标</th>
                    <th scope="col">基准命中率</th>
                    <th scope="col">样本内 AUC</th>
                    <th scope="col">留一年 AUC 均值</th>
                    <th scope="col">分年 AUC</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="t in targets" :key="t.key">
                    <td>{{ t.cn }}</td>
                    <td class="num">{{ fmtPct(t.basePct, 2) }}</td>
                    <td class="num">{{ fmtNum(model.metrics && model.metrics[t.key] && model.metrics[t.key].aucInsample, 4) }}</td>
                    <td class="num">{{ fmtNum(t.aucLoo, 4) }}</td>
                    <td class="num">{{ t.byYear.map(y => y.year + ' ' + fmtNum(y.auc, 4)).join(' · ') || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel" aria-label="十分位校准">
            <div class="panel-head">
              <div class="panel-title">
                <h2>十分位校准 · {{ targetCn }}</h2>
                <p class="summary">
                  把留一年预测概率按十分位分档，比对「预测 vs 实际」。lift = 实际 ÷ 抽样基准
                  （{{ fmtPct(calibBase, 2) }}）。预测贴近实际说明概率可直接当命中率读。
                </p>
              </div>
            </div>
            <div v-if="!deciles.length" class="status empty" role="status" aria-live="polite">该目标暂无校准数据。</div>
            <div v-else class="table-wrap">
              <table>
                <caption class="visually-hidden">{{ targetCn }} 十分位校准</caption>
                <thead>
                  <tr>
                    <th scope="col">分位</th>
                    <th scope="col">样本</th>
                    <th scope="col">预测概率</th>
                    <th scope="col">实际命中</th>
                    <th scope="col">lift</th>
                    <th scope="col">早盘最高均</th>
                    <th scope="col">开盘卖出均</th>
                    <th scope="col">止盈模型均</th>
                    <th scope="col">触涨停占比</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="d in deciles" :key="d.decile">
                    <td class="num">第 {{ d.decile }} 档</td>
                    <td class="num">{{ fmtCount(d.n) }}</td>
                    <td class="num">{{ fmtPct(d.predPct, 2) }}</td>
                    <td class="num">{{ fmtPct(d.actualPct, 2) }}</td>
                    <td class="num">{{ fmtNum(d.liftVsBase, 3) }}</td>
                    <td class="num" :class="signClass(d.retHighMeanPct)">{{ fmtPct(d.retHighMeanPct, 3) }}</td>
                    <td class="num" :class="signClass(d.retOpenMeanPct)">{{ fmtPct(d.retOpenMeanPct, 3) }}</td>
                    <td class="num" :class="signClass(d.stratMeanPct)">{{ fmtPct(d.stratMeanPct, 3) }}</td>
                    <td class="num">{{ fmtPct(d.limitUpPct, 2) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel" aria-label="每日选股模拟">
            <div class="panel-head">
              <div class="panel-title">
                <h2>每日 Top-K 选股模拟</h2>
                <p class="summary">按留一年概率每天取前 K 只（无重叠限制），统计次日早盘结果。开盘卖出均列为负数表示「开盘直接跑会亏」。</p>
              </div>
            </div>
            <div v-if="!topk.length" class="status empty" role="status" aria-live="polite">模型未产出 Top-K 模拟结果。</div>
            <div v-else class="table-wrap">
              <table>
                <caption class="visually-hidden">每日 Top-K 选股模拟</caption>
                <thead>
                  <tr>
                    <th scope="col">组合</th>
                    <th scope="col">交易日</th>
                    <th scope="col">笔数</th>
                    <th scope="col">≥+3%</th>
                    <th scope="col">触涨停</th>
                    <th scope="col">早盘最高均</th>
                    <th scope="col">开盘卖出均</th>
                    <th scope="col">止盈模型均</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="k in topk" :key="k.key">
                    <td>{{ k.cn }}</td>
                    <td class="num">{{ fmtCount(k.days) }}</td>
                    <td class="num">{{ fmtCount(k.n) }}</td>
                    <td class="num">{{ fmtPct(k.hit3Pct, 2) }}</td>
                    <td class="num">{{ fmtPct(k.limitUpPct, 2) }}</td>
                    <td class="num pos">{{ fmtPct(k.retHighPct, 3) }}</td>
                    <td class="num" :class="signClass(k.retOpenPct)">{{ fmtPct(k.retOpenPct, 3) }}</td>
                    <td class="num" :class="signClass(k.stratPct)">{{ fmtPct(k.stratPct, 3) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="topkYearRows.length" class="summary backtest-note">
              前 3 只分年 ≥+3%：{{ topkYearRows.map(y => y.year + ' ' + fmtPct(y.hit3Pct, 2)).join(' · ') }}
              （同期开盘卖出均 {{ topkYearRows.map(y => fmtPct(y.retOpenPct, 2)).join(' / ') }}）。
            </p>
          </section>

          <section class="panel" aria-label="特征系数与风险提示">
            <div class="panel-head">
              <div class="panel-title">
                <h2>特征权重与风险边界</h2>
                <p class="summary">系数是标准化空间里的 loglift 权重，符号表示方向，绝对值表示影响强度（截距 {{ fmtNum(model.targets && model.targets[backtest.modelTarget] && model.targets[backtest.modelTarget].intercept, 3) }}）。</p>
              </div>
            </div>
            <div class="backtest-model-grid">
              <div class="table-wrap">
                <table>
                  <caption class="visually-hidden">影响最强的特征权重</caption>
                  <thead>
                    <tr><th scope="col">特征</th><th scope="col">单位</th><th scope="col">权重</th><th scope="col">方向</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="c in coefs" :key="c.key">
                      <td>{{ c.cn }}</td>
                      <td>{{ c.unit || '—' }}</td>
                      <td class="num">{{ fmtNum(c.coef, 4) }}</td>
                      <td>{{ c.coef >= 0 ? '越高越易命中' : '越高越不易命中' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="backtest-risk">
                <h3>必须一起读的风险</h3>
                <ul>
                  <li v-for="r in riskNotes" :key="r.key"><strong>{{ r.cn }}</strong><span>{{ r.text }}</span></li>
                </ul>
              </div>
            </div>
          </section>
        </template>
      </section>

      <!-- ───── 分档统计 ───── -->
      <section v-if="backtest.tab === 'stats'" id="bt-panel-stats" role="tabpanel" aria-labelledby="bt-tab-stats" tabindex="0">
        <section class="panel" aria-label="分档统计">
          <div class="panel-head">
            <div class="panel-title">
              <h2>分档统计 · {{ dimLabel(backtest.statDimension) }}</h2>
              <p class="summary">
                批次 #{{ backtest.runId }} 的 {{ dimensions.length }} 个维度，看「该特征档历史上次日早盘 ≥+3% 的比例」。
                lift3 是与全样本基准 {{ fmtPct(overallHit3, 2) }} 的比值。
              </p>
            </div>
            <div class="backtest-actions" role="group" aria-label="排序方式">
              <button type="button" class="chip" :aria-pressed="backtest.statSort === 'bucket'" @click="setStatSort('bucket')">按分档顺序</button>
              <button type="button" class="chip" :aria-pressed="backtest.statSort === 'lift3'" @click="setStatSort('lift3')">按 lift3 降序</button>
            </div>
          </div>

          <div v-if="!dimensions.length" class="status empty" role="status" aria-live="polite">
            批次 #{{ backtest.runId }} 暂无分档统计（data/backtest.db 的 bt_stat）。
          </div>
          <template v-else>
            <div class="chips backtest-dim-chips" role="group" aria-label="统计维度选择">
              <button
                v-for="d in dimensions" :key="d.dimension" type="button" class="chip"
                :aria-pressed="backtest.statDimension === d.dimension" @click="selectDimension(d.dimension)"
              >{{ d.cn }} <span class="num">{{ d.bucketCnt }}</span></button>
            </div>

            <div v-if="backtest.statsLoading" class="status loading" role="status" aria-live="polite">正在读取分档…</div>
            <div v-else-if="!statRows.length" class="status empty" role="status" aria-live="polite">该维度暂无分档行。</div>
            <div v-else class="table-wrap">
              <table>
                <caption class="visually-hidden">{{ dimLabel(backtest.statDimension) }} 分档统计</caption>
                <thead>
                  <tr>
                    <th scope="col">分档</th>
                    <th scope="col">样本</th>
                    <th scope="col">≥+3%</th>
                    <th scope="col">lift3</th>
                    <th scope="col">95% 置信区间</th>
                    <th scope="col">开盘卖出均</th>
                    <th scope="col">早盘最高均</th>
                    <th scope="col">策略均收</th>
                    <th scope="col">胜率</th>
                    <th scope="col">盈亏比</th>
                    <th scope="col">稳定性</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in statRows" :key="row.dimension + '|' + row.bucket">
                    <td :title="row.note || ''">{{ row.bucket }}</td>
                    <td class="num">{{ fmtCount(row.sampleCnt) }}</td>
                    <td class="num">{{ fmtPct(row.hit3Pct, 2) }}</td>
                    <td class="num" :class="row.lift3 >= 1 ? 'pos' : 'muted'">{{ fmtNum(row.lift3, 3) }}</td>
                    <td class="num muted">{{ fmtPct(row.ci95Low, 2) }} ~ {{ fmtPct(row.ci95High, 2) }}</td>
                    <td class="num" :class="signClass(row.retOpenMean)">{{ fmtPct(row.retOpenMean, 3) }}</td>
                    <td class="num" :class="signClass(row.retHighMean)">{{ fmtPct(row.retHighMean, 3) }}</td>
                    <td class="num" :class="signClass(row.stratMean)">{{ fmtPct(row.stratMean, 3) }}</td>
                    <td class="num">{{ fmtPct(row.winRate, 2) }}</td>
                    <td class="num">{{ fmtNum(row.profitFactor, 2) }}</td>
                    <td>{{ stabilityCn(row.stability) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </section>
      </section>

      <!-- ───── 时点网格 ───── -->
      <section v-if="backtest.tab === 'timing'" id="bt-panel-timing" role="tabpanel" aria-labelledby="bt-tab-timing" tabindex="0">
        <section class="panel" aria-label="模型时点建议">
          <div class="panel-head">
            <div class="panel-title">
              <h2>时点建议（第二套概率模型：14:30~14:55 买 / 09:30~10:00 卖）</h2>
              <p class="summary">基于 {{ timing.months || '—' }} 个月、{{ fmtCount(timing.poolN) }} 笔的分钟级网格；判定「月度稳健」要求每个月的均值都优于基线。</p>
            </div>
          </div>
          <div v-if="!timing.insampleBest" class="status empty" role="status" aria-live="polite">模型未产出时点建议。</div>
          <template v-else>
            <div class="market-stats">
              <div class="stat"><span>基线 14:30 → 09:30</span><strong :class="signClass(timing.baselinePct)">{{ fmtPct(timing.baselinePct, 4) }}</strong></div>
              <div class="stat"><span>样本内最优 {{ timing.insampleBest.buy }} → {{ timing.insampleBest.sell }}</span><strong :class="signClass(timing.insampleBest.poolMeanPct)">{{ fmtPct(timing.insampleBest.poolMeanPct, 4) }}</strong></div>
              <div class="stat"><span>较基线</span><strong :class="signClass(timing.insampleBest.vsBaselinePct)">{{ fmtPct(timing.insampleBest.vsBaselinePct, 4) }}</strong></div>
              <div class="stat"><span>各月相对基线区间</span><strong class="backtest-stat-text">{{ fmtPct(timing.insampleBest.monthMinDeltaPct, 3) }} ~ {{ fmtPct(timing.insampleBest.monthMaxDeltaPct, 3) }}</strong></div>
            </div>
            <p class="status" :class="timing.strictStableExists ? '' : 'concentration-warning'" role="status" aria-live="polite">
              {{ timing.strictStableExists
                ? '存在月度稳健组合：' + timing.stableBest.buy + ' → ' + timing.stableBest.sell + '（最差月相对基线 ' + fmtPct(timing.stableBest.monthMinDeltaPct, 4) + '）'
                : '没有严格稳定点：没有任何组合在全部月份都优于基线；' + timing.insampleBest.buy + ' → ' + timing.insampleBest.sell + ' 只是样本内最优，最差月份仍低于基线 ' + fmtPct(timing.insampleBest.monthMinDeltaPct, 4) + '。' }}
            </p>
          </template>
        </section>

        <section class="panel" aria-label="分钟网格">
          <div class="panel-head">
            <div class="panel-title">
              <h2>分钟网格明细</h2>
              <p class="summary">
                批次 {{ gridRunKey }}，共 {{ fmtCount(backtest.grid.length) }} 个买卖组合；
                选一个买入时刻，看该时刻下所有卖出时点的均值。
              </p>
            </div>
          </div>
          <div v-if="!backtest.grid.length" class="status empty" role="status" aria-live="polite">
            回测库暂无时点网格：旧的 14:30~14:55 网格已按新口径清出，当前在库批次为
            {{ legText }}（bt_reverse_sample / bt_stat），未重新计算买卖时点网格。
          </div>
          <template v-else>
            <div class="chips backtest-buy-chips" role="group" aria-label="买入时刻选择">
              <button
                v-for="b in gridBuys" :key="b" type="button" class="chip"
                :aria-pressed="backtest.gridBuy === fmtMinute(b)" @click="selectGridBuy(b)"
              >{{ fmtMinute(b) }}</button>
            </div>

            <h3 class="backtest-h3">买入 {{ backtest.gridBuy }} 下的卖出腿</h3>
            <div class="table-wrap">
              <table>
                <caption class="visually-hidden">买入 {{ backtest.gridBuy }} 下各卖出时点</caption>
                <thead>
                  <tr>
                    <th scope="col">卖出时刻</th>
                    <th scope="col">样本</th>
                    <th scope="col">平均收益</th>
                    <th scope="col">收益中位数</th>
                    <th scope="col">≥+3%</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in gridSells" :key="r.sellMinute">
                    <td class="num">{{ fmtMinute(r.sellMinute) }}</td>
                    <td class="num">{{ fmtCount(r.sampleCnt) }}</td>
                    <td class="num" :class="signClass(r.retMeanPct)">{{ fmtPct(r.retMeanPct, 4) }}</td>
                    <td class="num" :class="signClass(r.retMedPct)">{{ fmtPct(r.retMedPct, 4) }}</td>
                    <td class="num">{{ fmtPct(r.hit3Pct, 2) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="summary backtest-note">本批次网格未计算胜率与收益标准差（bt_time_grid.winRate / retStdPct 为空），页面不显示空列。</p>

            <h3 class="backtest-h3">全网格均值最高的 8 个组合</h3>
            <div class="table-wrap">
              <table>
                <caption class="visually-hidden">全网格均值最高的组合</caption>
                <thead>
                  <tr>
                    <th scope="col">买入</th>
                    <th scope="col">卖出</th>
                    <th scope="col">样本</th>
                    <th scope="col">平均收益</th>
                    <th scope="col">收益中位数</th>
                    <th scope="col">≥+3%</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in gridTop" :key="r.buyMinute + '-' + r.sellMinute">
                    <td class="num">{{ r.buy }}</td>
                    <td class="num">{{ r.sell }}</td>
                    <td class="num">{{ fmtCount(r.sampleCnt) }}</td>
                    <td class="num" :class="signClass(r.retMeanPct)">{{ fmtPct(r.retMeanPct, 4) }}</td>
                    <td class="num" :class="signClass(r.retMedPct)">{{ fmtPct(r.retMedPct, 4) }}</td>
                    <td class="num">{{ fmtPct(r.hit3Pct, 2) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 class="backtest-h3">买入时点曲线（卖出固定 {{ timing.insampleBest ? timing.insampleBest.sell : '09:56' }}）</h3>
            <div class="table-wrap">
              <table>
                <caption class="visually-hidden">买入时点曲线</caption>
                <thead>
                  <tr><th scope="col">买入时刻</th><th scope="col">组合均值</th></tr>
                </thead>
                <tbody>
                  <tr v-for="r in buyCurve" :key="r.buy">
                    <td class="num">{{ r.buy }}</td>
                    <td class="num" :class="signClass(r.poolPct)">{{ fmtPct(r.poolPct, 4) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </section>
      </section>

      <!-- ───── 实盘凭据 ───── -->
      <section v-if="backtest.tab === 'decisions'" id="bt-panel-decisions" role="tabpanel" aria-labelledby="bt-tab-decisions" tabindex="0">
        <section class="panel" aria-label="实盘凭据命中率">
          <div class="panel-head">
            <div class="panel-title">
              <h2>实盘凭据（bt_decision）</h2>
              <p class="summary">回测结论不构成下单指令；凭据由人工确认后写入，次日回填实际结果，用于「回测 → 实盘」一致性核对。</p>
            </div>
            <div class="backtest-actions">
              <button class="btn mini" :disabled="backtest.loading" @click="loadDecisions()">刷新凭据</button>
            </div>
          </div>
          <div v-if="backtest.decisionsError" class="status error" role="status" aria-live="polite">{{ backtest.decisionsError }}</div>
          <div class="market-stats">
            <div class="stat"><span>累计决策</span><strong>{{ fmtCount(scorecard.total) }}</strong></div>
            <div class="stat"><span>已回填</span><strong>{{ fmtCount(scorecard.settled) }}</strong></div>
            <div class="stat"><span>命中 ≥+3%</span><strong>{{ fmtCount(scorecard.hits) }}</strong></div>
            <div class="stat"><span>实盘命中率</span><strong :class="signClass(scorecard.hit3Pct)">{{ fmtPct(scorecard.hit3Pct, 2) }}</strong></div>
            <div class="stat"><span>平均卖出收益</span><strong :class="signClass(scorecard.avgExitRet)">{{ fmtPct(scorecard.avgExitRet, 3) }}</strong></div>
            <div class="stat"><span>覆盖日期</span><strong class="backtest-stat-text">{{ fmtDate(scorecard.firstDate) }} ~ {{ fmtDate(scorecard.lastDate) }}</strong></div>
          </div>
          <p class="summary backtest-note">对照口径：模型留一年 ≥+3% 预测率约 {{ fmtPct(decileTopPred, 2) }}（最高十分位），每日前 3 只历史命中 {{ fmtPct(topk3Hit3, 2) }}。</p>
        </section>

        <section class="panel" aria-label="实盘凭据明细">
          <div class="panel-head">
            <div class="panel-title">
              <h2>凭据明细</h2>
              <p class="summary">按决策日倒序、评分降序，最多 200 条。</p>
            </div>
          </div>
          <div v-if="!decisions.length" class="status empty" role="status" aria-live="polite">
            尚无实盘凭据。等回测结论确认后，用 POST /api/decisions 写入当日候选，次日回填实际早盘最高与实际卖出价。
          </div>
          <div v-else class="table-wrap">
            <table>
              <caption class="visually-hidden">实盘凭据明细</caption>
              <thead>
                <tr>
                  <th scope="col">决策日</th>
                  <th scope="col">代码</th>
                  <th scope="col">名称</th>
                  <th scope="col">评分</th>
                  <th scope="col">≥+3% 概率</th>
                  <th scope="col">≥+5% 概率</th>
                  <th scope="col">涨停概率</th>
                  <th scope="col">期望早盘最高</th>
                  <th scope="col">期望开盘</th>
                  <th scope="col">建议买入</th>
                  <th scope="col">建议卖出</th>
                  <th scope="col">市场温度</th>
                  <th scope="col">行业热度</th>
                  <th scope="col">置信度</th>
                  <th scope="col">实际早盘最高</th>
                  <th scope="col">实际卖出</th>
                  <th scope="col">命中 ≥+3%</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in decisions" :key="d.tradeDate + '-' + d.code">
                  <td class="num">{{ fmtDate(d.tradeDate) }}</td>
                  <td class="num">{{ d.code }}</td>
                  <td>{{ d.name || '—' }}</td>
                  <td class="num">{{ fmtNum(d.score, 1) }}</td>
                  <td class="num">{{ fmtPct(d.up3Prob, 2) }}</td>
                  <td class="num">{{ fmtPct(d.up5Prob, 2) }}</td>
                  <td class="num">{{ fmtPct(d.limitUpProb, 2) }}</td>
                  <td class="num" :class="signClass(d.expectedRetHigh)">{{ fmtPct(d.expectedRetHigh, 3) }}</td>
                  <td class="num" :class="signClass(d.expectedRetOpen)">{{ fmtPct(d.expectedRetOpen, 3) }}</td>
                  <td class="num">{{ fmtMinute(d.suggestedBuyTime) }}</td>
                  <td class="num">{{ fmtMinute(d.suggestedSellTime) }}</td>
                  <td class="num">{{ fmtRatioPct(d.marketTemp) }}</td>
                  <td class="num">{{ fmtRatioPct(d.sectorHeat) }}</td>
                  <td>{{ confidenceCn(d.confidence) }}</td>
                  <td class="num" :class="signClass(d.actualRetHigh)">{{ fmtPct(d.actualRetHigh, 3) }}</td>
                  <td class="num" :class="signClass(d.actualRetExit)">{{ fmtPct(d.actualRetExit, 3) }}</td>
                  <td>{{ d.hit3 === null || d.hit3 === undefined ? '待回填' : (Number(d.hit3) === 1 ? '命中' : '未命中') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </template>
</template>

<script setup>
import { computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore } from '../stores/app';
import { useBacktestStore } from '../stores/backtest';

const TABS = [
  { key: 'overview', cn: '概览' },
  { key: 'model', cn: '概率模型' },
  { key: 'stats', cn: '分档统计' },
  { key: 'timing', cn: '时点网格' },
  { key: 'decisions', cn: '实盘凭据' },
];

const TAB_LABELS = Object.fromEntries(TABS.map((t) => [t.key, t.cn]));

const STABILITY_CN = { stable: '稳健', fragile: '脆弱', insufficient: '样本不足' };
const CONFIDENCE_CN = { high: '高', medium: '中', low: '低' };

const appStore = useAppStore();
const { mode } = storeToRefs(appStore);

const bt = useBacktestStore();
const {
  backtest, runs, counts, dimensions, statRows, targets, deciles, topk, coefs, riskNotes,
  gridBuys, gridSells, gridTop, legText,
} = storeToRefs(bt);
const { load, loadDecisions, switchTab, selectRun, selectDimension, selectGridBuy, selectTarget, setStatSort, dimLabel, fmtMinute } = bt;

const model = computed(() => backtest.value.model);

const activeRun = computed(() => (runs.value || [])
  .find((r) => Number(r.runId) === Number(backtest.value.runId)) || null);
const universeText = computed(() => (activeRun.value && activeRun.value.universeFilter)
  || (model.value && model.value.notes && model.value.notes.length ? '见模型说明' : '个股（剔除银行/退市/B股/ST/科创板/北交所）'));

const COUNT_CN = {
  bt_reverse_sample: '反推逐笔采样', bt_reverse_feature: '反推入模特征',
  bt_trade: '逐笔明细（日线）', bt_trade_tf: '逐笔明细（分钟）', bt_stat: '分档统计',
  bt_pattern_def: '形态字典', bt_feature_def: '字段字典', bt_time_grid: '时点组合',
  bt_market_day: '市场日', bt_sector_day: '行业日',
};
const countCards = computed(() => Object.keys(COUNT_CN)
  .map((key) => ({ key, cn: COUNT_CN[key], value: (counts.value || {})[key] })));

const loadedText = computed(() => (backtest.value.loadedAt
  ? '读取于 ' + new Date(backtest.value.loadedAt).toLocaleTimeString('zh-CN', { hour12: false })
  : '尚未读取'));

const overallHit3 = computed(() => {
  const row = (statRows.value || []).find((r) => r.dimension === 'overall');
  if (row) return row.hit3Pct;
  const anyOverall = (backtest.value.stats || []).find((r) => r.dimension === 'overall');
  return anyOverall ? anyOverall.hit3Pct : (model.value ? model.value.baseFullHit3Pct : null);
});

const targetCn = computed(() => {
  const t = (targets.value || []).find((x) => x.key === backtest.value.modelTarget);
  return t ? t.cn : TAB_LABELS.model;
});
const calibBase = computed(() => {
  const c = model.value && model.value.calibration ? model.value.calibration[backtest.value.modelTarget] : null;
  return c ? c.baseHitPct : null;
});
const decileTopPred = computed(() => {
  const last = deciles.value.length ? deciles.value[deciles.value.length - 1] : null;
  return last ? last.predPct : null;
});
const topk3Hit3 = computed(() => {
  const row = (topk.value || []).find((k) => k.key === 'top3');
  return row ? row.hit3Pct : null;
});
const topkYearRows = computed(() => {
  const row = (topk.value || []).find((k) => k.key === 'top3');
  return (row && row.byYear) || [];
});

const timing = computed(() => (model.value && model.value.timing) || {});
const buyCurve = computed(() => timing.value.buyCurve || []);
const gridRunKey = computed(() => {
  const run = (runs.value || []).find((r) => String(r.runKey || '').startsWith('grid-'));
  return run ? run.runKey : '（未找到网格批次）';
});
const scorecard = computed(() => backtest.value.scorecard || {});
const decisions = computed(() => backtest.value.decisions || []);

const signClass = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  return n > 0 ? 'pos' : 'neg';
};
const stabilityCn = (value) => STABILITY_CN[value] || value || '—';
const confidenceCn = (value) => CONFIDENCE_CN[value] || value || '—';
const fmtNum = (value, digits = 2) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
};
const fmtPct = (value, digits = 2) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) + '%' : '—';
};
// 0~1 的分位值（市场温度、行业热度）按百分比显示。
const fmtRatioPct = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? (n * 100).toFixed(1) + '%' : '—';
};
const fmtCount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('zh-CN') : '—';
};
const fmtDate = (value) => {
  const text = String(value === null || value === undefined ? '' : value);
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}` : (text || '—');
};
const fmtStamp = (value) => String(value || '').replace('T', ' ').slice(0, 19) || '—';

// 直接刷新或恢复上次模式时都要拉数：mode 从 localStorage 恢复不会经过 switchMode。
watch(() => mode.value, (next) => { if (next === 'backtest') load(); }, { immediate: true });
</script>
