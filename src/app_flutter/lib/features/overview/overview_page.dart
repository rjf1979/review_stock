import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/format.dart';
import '../../core/status_views.dart';
import '../../data/models.dart';
import '../../state/providers.dart';

/// 大盘概况：指数详情表 + 行业板块涨幅 + 两市成交额。
class OverviewPage extends ConsumerWidget {
  const OverviewPage({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final realtime = ref.watch(realtimeProvider);
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(realtimeProvider),
      child: realtime.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => RefreshableErrorView(
          message: friendlyErrorMessage(e),
          onRetry: () => ref.invalidate(realtimeProvider),
        ),
        data: (r) => _body(context, r),
      ),
    );
  }

  Widget _body(BuildContext context, RealtimeSnapshot r) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        _card(theme, '主要指数', child: _indexTable(context, r.indices)),
        _card(theme, '行业板块涨幅', child: _sectors(context, r.sectors)),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('两市成交额',
                    style: TextStyle(fontSize: 13, color: Colors.grey)),
                Text(fmtWan(r.breadth.amount),
                    style: const TextStyle(
                        fontSize: 20, fontWeight: FontWeight.w700)),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        const Text('以上为统计性数据展示，仅供参考，不构成投资建议。',
            style: TextStyle(fontSize: 11, color: Colors.grey)),
      ],
    );
  }

  Widget _indexTable(BuildContext context, List<IndexQuote> indices) {
    return Column(
      children: [
        _thead('指数', '现价', '涨跌幅', '成交额'),
        ...indices.map((i) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  Expanded(flex: 1, child: Text(i.name)),
                  Expanded(
                      flex: 1,
                      child: Text(fmtNum(i.price),
                          textAlign: TextAlign.right,
                          style: TextStyle(
                              color: pctColor(context, i.changePct)))),
                  Expanded(
                      flex: 1,
                      child: Text(pctText(i.changePct),
                          textAlign: TextAlign.right,
                          style: TextStyle(
                              color: pctColor(context, i.changePct)))),
                  Expanded(
                      flex: 1,
                      child: Text(fmtWan(i.amount),
                          textAlign: TextAlign.right,
                          style: const TextStyle(color: Colors.grey))),
                ],
              ),
            )),
      ],
    );
  }

  Widget _thead(String a, String b, String c, String d) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          Expanded(
              flex: 1,
              child: Text(a,
                  style: const TextStyle(fontSize: 12, color: Colors.grey))),
          Expanded(
              flex: 1,
              child: Text(b,
                  style: const TextStyle(fontSize: 12, color: Colors.grey),
                  textAlign: TextAlign.right)),
          Expanded(
              flex: 1,
              child: Text(c,
                  style: const TextStyle(fontSize: 12, color: Colors.grey),
                  textAlign: TextAlign.right)),
          Expanded(
              flex: 1,
              child: Text(d,
                  style: const TextStyle(fontSize: 12, color: Colors.grey),
                  textAlign: TextAlign.right)),
        ],
      ),
    );
  }

  Widget _sectors(BuildContext context, List<Sector> list) {
    if (list.isEmpty) {
      return const Text('暂无板块数据', style: TextStyle(color: Colors.grey));
    }
    return Column(
      children: list
          .take(8)
          .map((s) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    Expanded(flex: 1, child: Text(s.name)),
                    const SizedBox(width: 8),
                    Expanded(
                        flex: 1,
                        child: Text(fmtWan(s.mainNet),
                            textAlign: TextAlign.right,
                            style: const TextStyle(
                                fontSize: 12, color: Colors.grey))),
                    SizedBox(
                        width: 70,
                        child: Text(pctText(s.changePct),
                            textAlign: TextAlign.right,
                            style: TextStyle(
                                color: pctColor(context, s.changePct)))),
                  ],
                ),
              ))
          .toList(),
    );
  }

  Widget _card(ThemeData theme, String title, {required Widget child}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
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
