import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/format.dart';
import '../../core/status_views.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../../state/providers.dart';

/// 实时行情：PC 版盘面数据的移动端紧凑版。
class RealtimePage extends ConsumerStatefulWidget {
  const RealtimePage({super.key});

  @override
  ConsumerState<RealtimePage> createState() => _RealtimePageState();
}

class _RealtimePageState extends ConsumerState<RealtimePage>
    with WidgetsBindingObserver {
  Timer? _autoRefreshTimer;
  int _intervalSeconds = 60;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _startAutoRefresh(ref.read(refreshIntervalProvider));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      ref.invalidate(realtimeProvider);
      _startAutoRefresh(_intervalSeconds);
    } else if (state == AppLifecycleState.paused) {
      _stopAutoRefresh();
    }
  }

  void _startAutoRefresh(int seconds) {
    _intervalSeconds = seconds;
    _autoRefreshTimer?.cancel();
    _autoRefreshTimer = Timer.periodic(Duration(seconds: seconds), (_) {
      final isResumed =
          WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
      if (mounted && isResumed) ref.invalidate(realtimeProvider);
    });
  }

  void _stopAutoRefresh() {
    _autoRefreshTimer?.cancel();
    _autoRefreshTimer = null;
  }

  @override
  void dispose() {
    _stopAutoRefresh();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final realtime = ref.watch(realtimeProvider);
    ref.listen(refreshIntervalProvider, (previous, next) {
      if (previous != next) {
        ref.invalidate(realtimeProvider);
        _startAutoRefresh(next);
      }
    });
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(realtimeProvider),
      child: realtime.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => RefreshableErrorView(
          message: friendlyErrorMessage(error),
          onRetry: () => ref.invalidate(realtimeProvider),
        ),
        data: (snapshot) => _body(context, snapshot),
      ),
    );
  }

  Widget _body(BuildContext context, RealtimeSnapshot snapshot) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 20),
      children: [
        Text('市场雷达', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 4),
        Text(
          '${snapshot.marketSession?.label ?? _sessionFallback(snapshot)} · '
          '${snapshot.asOfDate ?? '日期待补充'} · 更新 ${fmtTime(snapshot.updatedAt)}',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: muted),
        ),
        const SizedBox(height: 12),
        _indexStrip(snapshot.indices),
        const SizedBox(height: 8),
        _breadthPanel(context, snapshot),
        _panel(
          context,
          '领涨行业',
          '东方财富行业',
          _sectorList(context, snapshot.sectors, falling: false),
        ),
        _panel(
          context,
          '领跌行业',
          '东方财富行业',
          _sectorList(context, snapshot.fallingSectors, falling: true),
        ),
        _panel(
          context,
          '领涨概念',
          '东方财富概念',
          _sectorList(context, snapshot.concepts, falling: false),
        ),
        _panel(
          context,
          '领跌概念',
          '东方财富概念',
          _sectorList(context, snapshot.fallingConcepts, falling: true),
        ),
        _panel(
          context,
          '主力净流入',
          '板块资金 · 亿元',
          _sectorList(
            context,
            snapshot.fundFlow,
            falling: false,
            showFlow: true,
          ),
        ),
        _panel(
          context,
          '主力净流出',
          '板块资金 · 亿元',
          _sectorList(
            context,
            snapshot.outflow,
            falling: true,
            showFlow: true,
          ),
        ),
        _panel(
          context,
          '涨幅榜',
          '全市场',
          _rankList(context, snapshot.topGainers),
        ),
        _panel(
          context,
          '跌幅榜',
          '全市场',
          _rankList(context, snapshot.topLosers),
        ),
        _panel(
          context,
          '成交额榜',
          '全市场 · 亿元',
          _rankList(context, snapshot.topTurnover, showAmount: true),
        ),
        _panel(
          context,
          '涨停梯队',
          _countMeta(snapshot.limitUpCount, '涨停'),
          _limitUpList(context, snapshot),
        ),
        _panel(
          context,
          '风险异动',
          _countMeta(snapshot.limitDownCount, '跌停'),
          _riskList(context, snapshot),
        ),
        Text(
          '行情来自公开源，仅供参考，不构成投资建议。红涨绿跌。',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: muted),
        ),
      ],
    );
  }

  String _sessionFallback(RealtimeSnapshot snapshot) {
    return snapshot.marketSession?.isTrading == true ? '盘中实时' : '最近交易日';
  }

  Widget _indexStrip(List<IndexQuote> indices) {
    return SizedBox(
      height: 92,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 4),
        itemCount: indices.length,
        separatorBuilder: (_, __) => const SizedBox(width: 24),
        itemBuilder: (context, index) {
          final quote = indices[index];
          return Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(quote.name, style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 4),
              Text(
                fmtNum(quote.price),
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: pctColor(context, quote.changePct),
                ),
              ),
              Text(
                pctText(quote.changePct),
                style: TextStyle(
                  fontSize: 12,
                  color: pctColor(context, quote.changePct),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _breadthPanel(BuildContext context, RealtimeSnapshot snapshot) {
    final breadth = snapshot.breadth;
    final pal = AppPalette.of(context);
    final total = (breadth.up ?? 0) + (breadth.down ?? 0) + (breadth.flat ?? 0);
    final upRatio = total > 0 ? (breadth.up ?? 0) / total : null;
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '市场红盘率',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      Text(
                        breadth.redRatio == null
                            ? '--'
                            : '${fmtNum(breadth.redRatio, digits: 1)}%',
                        style:
                            Theme.of(context).textTheme.headlineSmall?.copyWith(
                                  color: pal.up,
                                  fontWeight: FontWeight.w800,
                                ),
                      ),
                    ],
                  ),
                ),
                Text(
                  breadth.status == 'ready' ? '已校验' : '更新中',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: muted),
                ),
              ],
            ),
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(99),
              child: LinearProgressIndicator(
                value: upRatio,
                minHeight: 6,
                backgroundColor: pal.down.withValues(alpha: 0.28),
                valueColor: AlwaysStoppedAnimation(pal.up),
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                _metric(context, '上涨', fmtNum(breadth.up, digits: 0), pal.up),
                _metric(context, '平盘', fmtNum(breadth.flat, digits: 0), muted),
                _metric(
                  context,
                  '下跌',
                  fmtNum(breadth.down, digits: 0),
                  pal.down,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                _metric(
                  context,
                  '涨停',
                  fmtNum(breadth.limitUp ?? snapshot.limitUpCount, digits: 0),
                  pal.up,
                ),
                _metric(
                  context,
                  '跌停',
                  fmtNum(
                    breadth.limitDown ?? snapshot.limitDownCount,
                    digits: 0,
                  ),
                  pal.down,
                ),
                _metric(
                  context,
                  '炸板',
                  fmtNum(breadth.broken ?? snapshot.brokenCount, digits: 0),
                  muted,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              '成交额 ${fmtWan(breadth.amount)} · 涨跌比 ${fmtNum(breadth.upDownRatio)} · 有效样本 ${fmtNum(breadth.sampleCount, digits: 0)}',
              style:
                  Theme.of(context).textTheme.bodySmall?.copyWith(color: muted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _metric(
      BuildContext context, String label, String value, Color color) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          Text(
            value,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _panel(
    BuildContext context,
    String title,
    String meta,
    Widget child,
  ) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                Text(
                  meta,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            child,
          ],
        ),
      ),
    );
  }

  Widget _sectorList(
    BuildContext context,
    List<Sector> items, {
    required bool falling,
    bool showFlow = false,
  }) {
    if (items.isEmpty) return _empty('暂无数据');
    return Column(
      children: [
        for (var i = 0; i < items.length; i++)
          _rowTile(
            context,
            title: items[i].name,
            subtitle: showFlow ? '主力 ${fmtWan(items[i].mainNet)}' : null,
            trailing: pctText(
              falling
                  ? (items[i].changePct ?? 0).abs() * -1
                  : items[i].changePct,
            ),
            color: pctColor(
              context,
              falling
                  ? (items[i].changePct ?? 0).abs() * -1
                  : items[i].changePct,
            ),
          ),
      ],
    );
  }

  Widget _rankList(
    BuildContext context,
    List<RankStock> items, {
    bool showAmount = false,
  }) {
    if (items.isEmpty) return _empty('暂无榜单数据');
    return Column(
      children: [
        for (final item in items)
          _rowTile(
            context,
            title: item.name,
            subtitle: showAmount
                ? '${fmtNum(item.close)} 元 · ${fmtWan(item.amountYi)}'
                : item.code,
            trailing: pctText(item.changePct),
            color: pctColor(context, item.changePct),
          ),
      ],
    );
  }

  Widget _limitUpList(BuildContext context, RealtimeSnapshot snapshot) {
    final items = snapshot.limitUpStocks;
    if (items.isEmpty) return _empty('暂无涨停明细');
    final maxStreak = items
        .map((item) => item.streak ?? 1)
        .reduce((value, element) => value > element ? value : element);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: Text(
            '共 ${snapshot.limitUpCount ?? items.length} 只 · 最高 $maxStreak 板',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
        for (final item in items)
          _rowTile(
            context,
            title: item.name,
            subtitle: item.sector?.isEmpty == false ? item.sector : item.code,
            trailing: '${item.streak ?? 1}板',
            color: AppPalette.of(context).up,
          ),
      ],
    );
  }

  Widget _riskList(BuildContext context, RealtimeSnapshot snapshot) {
    final downItems = snapshot.limitDownStocks;
    final items = [...downItems, ...snapshot.brokenStocks];
    if (items.isEmpty) {
      return _empty(snapshot.brokenCount == null ? '暂无风险异动' : '仅有数量，明细未返回');
    }
    return Column(
      children: [
        for (final item in items)
          _rowTile(
            context,
            title: item.name,
            subtitle: item.sector?.isEmpty == false ? item.sector : item.code,
            trailing:
                downItems.contains(item) ? '跌停' : '炸${item.brokenCount ?? 1}次',
            color: downItems.contains(item)
                ? AppPalette.of(context).down
                : Theme.of(context).colorScheme.onSurfaceVariant,
          ),
      ],
    );
  }

  Widget _rowTile(
    BuildContext context, {
    required String title,
    String? subtitle,
    required String trailing,
    required Color color,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                if (subtitle != null && subtitle.isNotEmpty)
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Text(
            trailing,
            style: TextStyle(fontWeight: FontWeight.w700, color: color),
          ),
        ],
      ),
    );
  }

  Widget _empty(String text) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: Center(child: Text(text)),
    );
  }

  String _countMeta(int? count, String label) {
    return count == null ? '$label · 数量待补充' : '$count $label';
  }
}
