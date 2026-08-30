import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../../state/providers.dart';

/// 实时行情：指数条 + 全市场宽度 + 涨停梯队 + 领涨板块 + 盘口异动。
class RealtimePage extends ConsumerStatefulWidget {
  const RealtimePage({super.key});
  @override
  ConsumerState<RealtimePage> createState() => _RealtimePageState();
}

class _RealtimePageState extends ConsumerState<RealtimePage> {
  @override
  Widget build(BuildContext context) {
    final realtime = ref.watch(realtimeProvider);
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(realtimeProvider),
      child: realtime.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ListView(
          children: [const SizedBox(height: 120), Center(child: Text('加载失败：$e'))],
        ),
        data: (r) => _body(context, r),
      ),
    );
  }

  Widget _body(BuildContext context, RealtimeSnapshot r) {
    final theme = Theme.of(context);
    return ListView(
      children: [
        _indexStrip(r.indices),
        _card(theme, '全市场',
            child: _breadth(r.breadth)),
        if (r.limitUpStocks.isNotEmpty)
          _card(theme, '涨停梯队', child: _ladder(r.limitUpStocks)),
        if (r.sectors.isNotEmpty)
          _card(theme, '领涨板块', child: _sectors(r.sectors)),
        if (r.pankou.isNotEmpty)
          _card(theme, '盘口异动', child: _pankou(r.pankou)),
        Padding(
          padding: const EdgeInsets.all(12),
          child: Text('数据来自公开行情源，仅供参考，不构成投资建议。红涨绿跌。',
              style: theme.textTheme.bodySmall?.copyWith(color: Colors.grey)),
        ),
      ],
    );
  }

  Widget _indexStrip(List<IndexQuote> indices) {
    return SizedBox(
      height: 92,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        children: indices
            .map((i) => Padding(
                  padding: const EdgeInsets.only(right: 28),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(i.name, style: const TextStyle(fontSize: 12, color: Colors.grey)),
                      const SizedBox(height: 4),
                      Text(fmtNum(i.price),
                          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: pctColor(context,i.changePct))),
                      Text(pctText(i.changePct),
                          style: TextStyle(fontSize: 12, color: pctColor(context,i.changePct))),
                    ],
                  ),
                ))
            .toList(),
      ),
    );
  }

  Widget _breadth(Breadth b) {
    return Row(
      children: [
        _bCell('上涨', AppPalette.of(context).up, fmtNum(b.up, digits: 0)),
        _bCell('下跌', AppPalette.of(context).down, fmtNum(b.down, digits: 0)),
        _bCell('涨停', AppPalette.of(context).up, fmtNum(b.limitUp, digits: 0)),
        _bCell('跌停', AppPalette.of(context).down, fmtNum(b.limitDown, digits: 0)),
        _bCell('成交额', AppPalette.of(context).ink, fmtWan(b.amount)),
      ],
    );
  }

  Widget _bCell(String label, Color color, String text) {
    return Expanded(
      child: Column(
        children: [
          Text(text, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: color)),
          const SizedBox(height: 4),
          Text(label, style: const TextStyle(fontSize: 11, color: Colors.grey)),
        ],
      ),
    );
  }

  Widget _ladder(List<LimitUpStock> list) {
    return Column(
      children: list
          .map((s) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    Expanded(child: Text(s.name)),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                          color: AppPalette.of(context).up.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
                      child: Text('${s.streak ?? 1}板', style: TextStyle(fontSize: 12, color: AppPalette.of(context).up)),
                    ),
                    const SizedBox(width: 12),
                    Text(pctText(s.changePct), style: TextStyle(color: pctColor(context,s.changePct))),
                  ],
                ),
              ))
          .toList(),
    );
  }

  Widget _sectors(List<Sector> list) {
    return Column(
      children: list
          .take(6)
          .map((s) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    Expanded(child: Text(s.name)),
                    Text(fmtWan(s.mainNet), style: const TextStyle(fontSize: 12, color: Colors.grey)),
                    const SizedBox(width: 12),
                    SizedBox(width: 70, child: Text(pctText(s.changePct), textAlign: TextAlign.right,
                        style: TextStyle(color: pctColor(context,s.changePct)))),
                  ],
                ),
              ))
          .toList(),
    );
  }

  Widget _pankou(List<PankouEvent> list) {
    return Column(
      children: list
          .take(8)
          .map((e) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(width: 52, child: Text(fmtTime(e.time), style: const TextStyle(fontSize: 12, color: Colors.grey))),
                    Expanded(child: Text(e.text, style: const TextStyle(fontSize: 13))),
                  ],
                ),
              ))
          .toList(),
    );
  }

  Widget _card(ThemeData theme, String title, {required Widget child}) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
      child: Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: theme.textTheme.titleSmall),
              const SizedBox(height: 12),
              child,
            ],
          ),
        ),
      ),
    );
  }
}
