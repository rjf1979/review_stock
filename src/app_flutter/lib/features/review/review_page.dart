import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/status_views.dart';
import '../../data/models.dart';
import '../../state/providers.dart';

/// 每日复盘：市场温度、宽度和情绪结构、板块资金、要闻与报告正文。
class ReviewPage extends ConsumerWidget {
  const ReviewPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final review = ref.watch(reviewProvider);
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(reviewProvider),
      child: review.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => RefreshableErrorView(
          message: friendlyErrorMessage(e),
          onRetry: () => ref.invalidate(reviewProvider),
        ),
        data: (r) => r.date.isEmpty
            ? const Center(child: Text('暂无复盘数据，等待 PC 端生成后上传'))
            : ReviewBody(review: r),
      ),
    );
  }
}

class ReviewBody extends StatelessWidget {
  const ReviewBody({required this.review, super.key});

  final ReviewDetail review;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        _hero(context),
        const SizedBox(height: 10),
        _metrics(context),
        const SizedBox(height: 10),
        _breadth(context),
        const SizedBox(height: 10),
        _indices(context),
        const SizedBox(height: 10),
        _heights(context),
        const SizedBox(height: 10),
        _sectors(context),
        const SizedBox(height: 10),
        _fundFlow(context),
        const SizedBox(height: 10),
        _risks(context),
        const SizedBox(height: 10),
        _news(context),
        const SizedBox(height: 10),
        _quality(context),
        const SizedBox(height: 10),
        Text(
          '复盘为统计性描述，不代表未来走势，不构成买卖建议。',
          style: Theme.of(context).textTheme.bodySmall,
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _hero(BuildContext context) {
    final palette = AppPalette.of(context);
    final temperature = review.temperature?.toInt();
    final temperatureColor = temperature != null && temperature <= 40
        ? palette.down
        : temperature != null && temperature > 70
            ? palette.up
            : palette.gold;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        review.date.isEmpty ? '--' : review.date,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          _chip(
                            context,
                            _modeLabel,
                            color: review.reportMode == 'close'
                                ? palette.up
                                : palette.muted,
                          ),
                          if (review.temperatureLevel.isNotEmpty)
                            _chip(
                              context,
                              review.temperatureLevel,
                              color: temperatureColor,
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      temperature == null ? '--' : '$temperature°',
                      style: Theme.of(context)
                          .textTheme
                          .headlineMedium
                          ?.copyWith(
                            color: temperatureColor,
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                    Text('市场温度 / 100',
                        style: Theme.of(context).textTheme.labelSmall),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 14),
            LinearProgressIndicator(
              value: review.temperature == null ? 0 : review.temperature! / 100,
              semanticsLabel: '市场温度 ${temperature ?? "无数据"}',
              color: temperatureColor,
              backgroundColor: palette.line,
              minHeight: 6,
              borderRadius: BorderRadius.circular(3),
            ),
          ],
        ),
      ),
    );
  }

  Widget _metrics(BuildContext context) {
    final limitUp = review.breadth.limitUp ?? review.limitUpCount;
    final limitDown = review.breadth.limitDown ?? review.limitDownCount;
    final broken = review.breadth.broken ?? review.brokenCount;

    return _card(
      context,
      '核心情绪',
      '涨停 · 封板 · 高度',
      [
        LayoutBuilder(
          builder: (context, constraints) {
            final tileWidth = (constraints.maxWidth - 8) / 2;
            return Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                SizedBox(
                  width: tileWidth,
                  child: _metric(
                    context,
                    fmtNum(limitUp, digits: 0),
                    '涨停家数',
                    AppPalette.of(context).up,
                  ),
                ),
                SizedBox(
                  width: tileWidth,
                  child: _metric(
                    context,
                    fmtNum(limitDown, digits: 0),
                    '跌停家数',
                    AppPalette.of(context).down,
                  ),
                ),
                SizedBox(
                  width: tileWidth,
                  child: _metric(
                    context,
                    fmtNum(broken, digits: 0),
                    '炸板家数',
                    AppPalette.of(context).flat,
                  ),
                ),
                SizedBox(
                  width: tileWidth,
                  child: _metric(
                    context,
                    review.maxBoardHeight == null ? '--' : '${review.maxBoardHeight}板',
                    '最高连板高度',
                    AppPalette.of(context).gold,
                  ),
                ),
              ],
            );
          },
        ),
      ],
    );
  }

  Widget _breadth(BuildContext context) {
    final breadth = review.breadth;
    final palette = AppPalette.of(context);

    return _card(
      context,
      '全市场宽度',
      breadth.status == 'ready' ? '全市场样本已校验' : '宽度待补充',
      [
        LinearProgressIndicator(
          value: breadth.redRatio == null ? 0 : breadth.redRatio! / 100,
          semanticsLabel: '红盘率 ${fmtNum(breadth.redRatio, digits: 1)}%',
          color: palette.up,
          backgroundColor: palette.line,
          minHeight: 6,
          borderRadius: BorderRadius.circular(3),
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            Text(
              '${fmtNum(breadth.redRatio, digits: 1)}% 红盘率',
              style: Theme.of(context).textTheme.labelSmall,
            ),
            const Spacer(),
            Text(
              '涨跌比 ${fmtNum(breadth.upDownRatio, digits: 2)}',
              style: Theme.of(context).textTheme.labelSmall,
            ),
          ],
        ),
        if (breadth.previousTurnoverYi != null) ...[
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: Text(
                  '昨日成交额 ${fmtNum(breadth.previousTurnoverYi, digits: 0)}亿',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '环比 ${pctText(breadth.turnoverChangeRate)}',
                style: TextStyle(
                  color: pctColor(context, breadth.turnoverChangeRate),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ],
        const SizedBox(height: 10),
        LayoutBuilder(
          builder: (context, constraints) {
            final tileWidth = (constraints.maxWidth - 16) / 3;
            return Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                SizedBox(
                  width: tileWidth,
                  child: _metric(context, fmtNum(breadth.up, digits: 0), '上涨', palette.up),
                ),
                SizedBox(
                  width: tileWidth,
                  child: _metric(context, fmtNum(breadth.flat, digits: 0), '平盘', palette.flat),
                ),
                SizedBox(
                  width: tileWidth,
                  child: _metric(context, fmtNum(breadth.down, digits: 0), '下跌', palette.down),
                ),
                SizedBox(
                  width: tileWidth,
                  child: _metric(context, fmtNum(breadth.amount, digits: 0), '成交额(亿)', null),
                ),
                SizedBox(
                  width: tileWidth,
                  child: _metric(context, fmtNum(breadth.sampleCount, digits: 0), '有效样本', null),
                ),
                SizedBox(
                  width: tileWidth,
                  child: _metric(context, fmtNum(breadth.reportedCount, digits: 0), '上报样本', null),
                ),
              ],
            );
          },
        ),
      ],
    );
  }

  Widget _indices(BuildContext context) {
    final maxChange = _maxAbsoluteValue(review.indices.map((e) => e.changePct));

    return _card(
      context,
      '主要指数表现',
      '收盘 · 涨跌幅 · 成交额',
      [
        if (review.indices.isEmpty)
          _empty('暂无指数数据')
        else
          Column(
            children: [
              for (final index in review.indices)
                _dataRow(
                  label: index.name,
                  value:
                      '${fmtNum(index.price, digits: 2)} · ${fmtNum(index.amount, digits: 0)}亿',
                  badge: pctText(index.changePct),
                  badgeColor: pctColor(context, index.changePct),
                  barWidth: _relativeWidth(index.changePct, maxChange),
                  barColor: pctColor(context, index.changePct),
                ),
            ],
          ),
      ],
    );
  }

  Widget _heights(BuildContext context) {
    final palette = AppPalette.of(context);
    final promotion = review.promotionRate == null
        ? '--'
        : '${fmtNum(review.promotionRate! * 100, digits: 1)}%';
    final sealRate = review.sealRate == null
        ? '--'
        : '${fmtNum(review.sealRate! * 100, digits: 1)}%';

    return _card(
      context,
      '连板梯队',
      '晋级率 $promotion · 封板率 $sealRate',
      [
        if (review.heightDistribution.isEmpty)
          _empty('暂无连板结构')
        else
          Column(
            children: [
              for (final group in review.heightDistribution)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 52,
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: palette.gold.withValues(alpha: 0.10),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          '${group.boardHeight}板',
                          style: TextStyle(
                            color: palette.gold,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${group.count ?? group.leaders.length} 家',
                                style: Theme.of(context).textTheme.labelMedium),
                            if (group.leaders.isNotEmpty)
                              Text(
                                group.leaders.join(' · '),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
      ],
    );
  }

  Widget _sectors(BuildContext context) {
    final palette = AppPalette.of(context);
    final maxChange = _maxAbsoluteValue(review.sectors.map((e) => e.changePct));

    return _card(
      context,
      '领涨行业',
      '涨跌幅排序',
      [
        if (review.sectors.isEmpty)
          _empty('暂无板块数据')
        else
          Column(
            children: [
              for (final sector in review.sectors.take(6))
                _dataRow(
                  label: sector.name,
                  value: sector.mainNet == null
                      ? ''
                      : '主力 ${fmtNum(sector.mainNet, digits: 2)}亿',
                  badge: pctText(sector.changePct),
                  badgeColor: pctColor(context, sector.changePct),
                  barWidth: _relativeWidth(sector.changePct, maxChange),
                  barColor: palette.up,
                ),
            ],
          ),
      ],
    );
  }

  Widget _fundFlow(BuildContext context) {
    final maxNet = _maxAbsoluteValue(review.fundFlow.map((e) => e.mainNet));

    return _card(
      context,
      '主力资金',
      '行业净流入 · 亿元',
      [
        if (review.fundFlow.isEmpty)
          _empty('暂无资金流数据')
        else
          Column(
            children: [
              for (final sector in review.fundFlow.take(6))
                _dataRow(
                  label: sector.name,
                  value: pctText(sector.changePct),
                  badge: fmtNum(sector.mainNet, digits: 2),
                  badgeColor: sector.mainNet != null && sector.mainNet! < 0
                      ? AppPalette.of(context).down
                      : AppPalette.of(context).up,
                  barWidth: _relativeWidth(sector.mainNet, maxNet),
                  barColor: AppPalette.of(context).up,
                ),
            ],
          ),
      ],
    );
  }

  Widget _risks(BuildContext context) {
    final palette = AppPalette.of(context);

    return _card(
      context,
      '风险与炸板',
      '跌停池 · 炸板池',
      [
        if (review.limitDownStocks.isEmpty && review.brokenStocks.isEmpty)
          _empty('暂无风险池数据')
        else ...[
          for (final stock in review.limitDownStocks.take(5))
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  Expanded(child: Text(stock.name, maxLines: 1)),
                  if (stock.sector?.isNotEmpty == true)
                    Text(stock.sector ?? '',
                        style: Theme.of(context).textTheme.labelSmall),
                  const SizedBox(width: 8),
                  Text('跌停',
                      style: TextStyle(
                          color: palette.down, fontWeight: FontWeight.w600)),
                ],
              ),
            ),
          for (final stock in review.brokenStocks.take(5))
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  Expanded(child: Text(stock.name, maxLines: 1)),
                  if (stock.sector?.isNotEmpty == true)
                    Text(stock.sector ?? '',
                        style: Theme.of(context).textTheme.labelSmall),
                  const SizedBox(width: 8),
                  Text(
                    stock.brokenCount == null ? '炸板' : '炸板${stock.brokenCount}次',
                    style: TextStyle(
                        color: palette.flat, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),
        ],
      ],
    );
  }

  Widget _news(BuildContext context) {
    return _card(
      context,
      '今日要闻',
      '${review.news.length} 条 · 按时间排序',
      [
        if (review.news.isEmpty)
          _empty('暂无今日要闻')
        else
          Column(
            children: [
              for (final news in review.news)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(
                        width: 46,
                        child: Text(news.time,
                            style: Theme.of(context).textTheme.labelSmall),
                      ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              news.title,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.bodyMedium,
                            ),
                            if (news.digest.isNotEmpty)
                              Text(
                                news.digest,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
      ],
    );
  }

  Widget _quality(BuildContext context) {
    final quality = review.quality;
    final palette = AppPalette.of(context);
    final missing = [
      ...quality.missingFields.map(_missingFieldLabel),
      ...quality.warnings,
    ];

    return _card(
      context,
      '数据核对',
      '${_qualityStatusLabel(quality.status)} · ${_confidenceLabel(quality.confidence)}',
      [
        if (missing.isEmpty)
          _empty('关键字段已齐备')
        else
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final item in missing)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('•', style: TextStyle(color: palette.gold)),
                      const SizedBox(width: 6),
                      Expanded(child: Text(item)),
                    ],
                  ),
                ),
            ],
          ),
      ],
    );
  }

  String _missingFieldLabel(String value) {
    return switch (value) {
      'breadth' => '全市场宽度',
      'breadth.previous_turnover_yuan' => '上个交易日成交额',
      'breadth.turnover_change_rate' => '成交额环比',
      'sentiment.promotion_rate' => '连板晋级率',
      'indices' => '历史指数',
      'industries' => '历史行业',
      'mainlines' => '历史行业排序',
      _ => value,
    };
  }

  String _qualityStatusLabel(String value) {
    return switch (value) {
      'ok' => '数据完整',
      'partial' => '部分完整',
      'warning' => '需要核对',
      _ => '未知',
    };
  }

  String _confidenceLabel(String value) {
    return switch (value) {
      'high' => '高置信',
      'medium' => '中置信',
      'low' => '低置信',
      _ => '未知',
    };
  }

  String get _modeLabel {
    return switch (review.reportMode) {
      'close' => '收盘复盘',
      'intraday' => '盘中复盘',
      'morning' => '午间快照',
      _ => '快照',
    };
  }

  Widget _card(
    BuildContext context,
    String title,
    String meta,
    List<Widget> children,
  ) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(title,
                      style: Theme.of(context).textTheme.titleSmall),
                ),
                Flexible(
                  child: Text(
                    meta,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            ...children,
          ],
        ),
      ),
    );
  }

  Widget _chip(BuildContext context, String text, {required Color color}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(5),
      ),
      child: Text(
        text,
        style: TextStyle(
            color: color, fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }

  Widget _metric(
    BuildContext context,
    String value,
    String label,
    Color? color,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: [
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: color,
                    fontWeight: FontWeight.w700,
                  ),
            ),
          ),
          const SizedBox(height: 3),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.labelSmall,
          ),
        ],
      ),
    );
  }

  Widget _dataRow({
    required String label,
    required String value,
    required String badge,
    required Color badgeColor,
    required double barWidth,
    required Color barColor,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
              Text(value,
                  style: const TextStyle(fontSize: 11, color: Colors.grey)),
              const SizedBox(width: 8),
              Text(
                badge,
                style:
                    TextStyle(color: badgeColor, fontWeight: FontWeight.w700),
              ),
            ],
          ),
          const SizedBox(height: 5),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              value: barWidth,
              color: barColor,
              backgroundColor: Colors.transparent,
              minHeight: 4,
            ),
          ),
        ],
      ),
    );
  }

  Widget _empty(String text) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Center(
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 12, color: Colors.grey),
        ),
      ),
    );
  }

  num? _maxAbsoluteValue(Iterable<num?> values) {
    final available = values.whereType<num>();
    return available.isEmpty
        ? null
        : available
            .map((value) => value.abs())
            .reduce((a, b) => a > b ? a : b);
  }

  double _relativeWidth(num? value, num? max) {
    if (value == null || max == null || max <= 0) return 0;
    return (value.abs() / max).clamp(0.0, 1.0).toDouble();
  }
}
