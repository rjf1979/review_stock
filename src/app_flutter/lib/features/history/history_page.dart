import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/format.dart';
import '../../core/status_views.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../review/review_page.dart';
import '../../state/providers.dart';

/// 历史报告：对齐 PC 端 history-card 的日期 + 温度 + 宽度摘要布局。
class HistoryPage extends ConsumerWidget {
  const HistoryPage({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final entries = ref.watch(reviewsProvider);
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(reviewsProvider),
      child: entries.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => RefreshableErrorView(
          message: friendlyErrorMessage(e),
          onRetry: () => ref.invalidate(reviewsProvider),
        ),
        data: (list) => list.isEmpty
            ? const Center(child: Text('暂无历史复盘报告'))
            : ListView.separated(
                padding: const EdgeInsets.all(12),
                itemCount: list.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, i) => _HistoryCard(
                  entry: list[i],
                  onOpen: () => _openReview(context, list[i].date),
                ),
              ),
      ),
    );
  }

  void _openReview(BuildContext context, String date) {
    // 点开某个历史报告 → 复用复盘详情，临时按日期加载。
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => _ReviewDetail(date: date)),
    );
  }
}

/// PC 端历史卡片：日期 + 模式、市场温度框（左色条 + 涨跌停）、涨跌宽度、查看动作。
class _HistoryCard extends StatelessWidget {
  const _HistoryCard({required this.entry, required this.onOpen});

  final ReviewEntry entry;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final palette = AppPalette.of(context);
    final tone = _temperatureTone(palette);

    return Card(
      clipBehavior: Clip.antiAlias,
      margin: EdgeInsets.zero,
      child: InkWell(
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Expanded(
                    child: Text(
                      entry.date,
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                  ),
                  Text(
                    _modeLabel,
                    style: TextStyle(
                      color: palette.muted,
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.4,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              _temperatureBox(context, palette, tone),
              const SizedBox(height: 10),
              Row(
                children: [
                  for (final (i, tile) in [
                    ('上涨', entry.up, palette.up),
                    ('平盘', entry.flat, palette.flat),
                    ('下跌', entry.down, palette.down),
                  ].indexed) ...[
                    if (i > 0) const SizedBox(width: 8),
                    Expanded(
                      child: _statTile(
                        context,
                        label: tile.$1,
                        value:
                            tile.$2 == null ? '—' : fmtNum(tile.$2, digits: 0),
                        valueColor: tile.$3,
                        color: palette.paper,
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 12),
              SizedBox(
                height: 44,
                child: OutlinedButton(
                  onPressed: onOpen,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: palette.ink,
                    backgroundColor: palette.card,
                    side: BorderSide(color: palette.line),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(6)),
                    textStyle: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w700),
                  ),
                  child: const Text('查看复盘'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// 市场温度框：左侧色条随温度等级变色，右挂涨停/跌停小格（对齐 PC history-temp）。
  Widget _temperatureBox(BuildContext context, AppPalette palette, Color tone) {
    final temperature = entry.temperature;
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: palette.paper,
        borderRadius: BorderRadius.circular(7),
        border: Border.all(color: palette.line),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(width: 4, color: tone),
            Expanded(
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
                child: Row(
                  children: [
                    Expanded(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          Text('市场温度',
                              style: TextStyle(
                                  color: palette.muted,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w800)),
                          const SizedBox(width: 6),
                          Text(
                            temperature == null
                                ? '—'
                                : fmtNum(temperature, digits: 0),
                            style: TextStyle(
                              color: temperature == null ? palette.muted : tone,
                              fontSize: 26,
                              height: 1,
                              fontWeight: FontWeight.w800,
                              fontFeatures: const [
                                FontFeature.tabularFigures()
                              ],
                            ),
                          ),
                          if (entry.temperatureLevel.isNotEmpty) ...[
                            const SizedBox(width: 6),
                            Flexible(
                              child: Text(
                                entry.temperatureLevel,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                    color: palette.muted,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w800),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    _limitTile(context, '涨停', entry.limitUpCount, palette.up),
                    const SizedBox(width: 8),
                    _limitTile(
                        context, '跌停', entry.limitDownCount, palette.down),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _limitTile(
      BuildContext context, String label, int? value, Color valueColor) {
    final palette = AppPalette.of(context);
    return Container(
      constraints: const BoxConstraints(minWidth: 48),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: palette.card,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: palette.line),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(label, style: TextStyle(color: palette.muted, fontSize: 10)),
          const SizedBox(height: 1),
          Text(
            value == null ? '—' : '$value',
            style: TextStyle(
              color: valueColor,
              fontSize: 15,
              height: 1.1,
              fontWeight: FontWeight.w700,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }

  /// 上涨/平盘/下跌 三格宽度摘要（对齐 PC history-breadth）。
  Widget _statTile(
    BuildContext context, {
    required String label,
    required String value,
    required Color valueColor,
    required Color color,
  }) {
    final palette = AppPalette.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: palette.line),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: palette.muted, fontSize: 10)),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              value,
              maxLines: 1,
              style: TextStyle(
                color: valueColor,
                fontSize: 14,
                height: 1.1,
                fontWeight: FontWeight.w700,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// 温度等级 → 主题色，对齐 PC tempTone；等级缺失时回退中性色。
  Color _temperatureTone(AppPalette palette) {
    return switch (entry.temperatureLevel) {
      '冰点' => palette.down,
      '低迷' => Color.lerp(palette.down, palette.gold, 0.32)!,
      '修复' => palette.gold,
      '活跃' => Color.lerp(palette.gold, palette.up, 0.38)!,
      '高温' || '过热' => palette.up,
      _ => palette.muted,
    };
  }

  String get _modeLabel {
    return switch (entry.reportMode) {
      'close' => '收盘',
      'intraday' => '盘中',
      'morning' => '午间',
      'historical' => '历史',
      _ => '快照',
    };
  }
}

/// 带日期参数的复盘详情（从历史进入）。
class _ReviewDetail extends ConsumerWidget {
  const _ReviewDetail({required this.date});
  final String date;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(reviewByDateProvider(date));
    return Scaffold(
      appBar: AppBar(title: Text(date)),
      body: detail.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => RefreshableErrorView(
          message: friendlyErrorMessage(e),
          onRetry: () => ref.invalidate(reviewByDateProvider(date)),
        ),
        data: (r) => r.date.isEmpty
            ? const Center(child: Text('该日期暂无复盘数据'))
            : ReviewBody(review: r),
      ),
    );
  }
}
