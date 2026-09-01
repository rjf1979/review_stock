import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/status_views.dart';
import '../../state/providers.dart';

/// 每日复盘：温度 + 宽窄指标 + 复盘正文。
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
        data: (r) => r.isEmpty
            ? const Center(child: Text('暂无复盘数据，等待 PC 端生成后上传'))
            : _body(context, r),
      ),
    );
  }

  Widget _body(BuildContext context, Map<String, dynamic> r) {
    final theme = Theme.of(context);
    final date = '${r['date'] ?? r['meta']?['trade_date'] ?? '--'}';
    final mode = '${r['meta']?['report_mode'] ?? 'snapshot'}';
    final temp = _tempScore(r['temperature']);
    final markdown = '${r['markdown'] ?? ''}';
    final payload = r['payload'] as Map<String, dynamic>? ?? {};
    final breadth = payload['breadth'] as Map<String, dynamic>? ?? {};
    final up = _int(breadth['up']);
    final down = _int(breadth['down']);
    final limitUp = _int(breadth['limitUp'] ?? r['limitUpCount']);
    final limitDown = _int(breadth['limitDown'] ?? r['limitDownCount']);

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(date,
                            style: const TextStyle(
                                fontSize: 17, fontWeight: FontWeight.w700)),
                        const SizedBox(height: 6),
                        Text(mode == 'close' ? '收盘复盘' : '午间快照',
                            style: TextStyle(
                                fontSize: 12,
                                color: mode == 'close'
                                    ? AppPalette.of(context).up
                                    : Colors.grey)),
                      ],
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text("${temp ?? '--'}°",
                            style: TextStyle(
                                fontSize: 30,
                                fontWeight: FontWeight.w800,
                                color: AppPalette.of(context).up)),
                        const Text('市场温度',
                            style: TextStyle(fontSize: 11, color: Colors.grey)),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    _kv(context, '上涨', up, AppPalette.of(context).up),
                    _kv(context, '下跌', down, AppPalette.of(context).down),
                    _kv(context, '涨停', limitUp, AppPalette.of(context).up),
                    _kv(context, '跌停', limitDown, AppPalette.of(context).down),
                  ],
                ),
              ],
            ),
          ),
        ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('复盘正文', style: theme.textTheme.titleSmall),
                const SizedBox(height: 12),
                markdown.isEmpty
                    ? const Text('暂无正文，敬请等待 PC 端生成复盘后上传。')
                    : Container(
                        constraints: const BoxConstraints(maxHeight: 500),
                        child: SingleChildScrollView(
                            child: Text(markdown,
                                style: const TextStyle(
                                    height: 1.7, fontSize: 13))),
                      ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        const Text('复盘为统计性描述，不代表未来走势，不构成买卖建议。',
            style: TextStyle(fontSize: 11, color: Colors.grey)),
      ],
    );
  }

  int? _tempScore(dynamic t) {
    final v = t is num ? t : (t is Map ? t['score'] : null);
    return v is num ? v.round() : null;
  }

  int? _int(dynamic v) => v is num ? v.toInt() : null;

  Widget _kv(BuildContext context, String label, int? value, Color color) {
    return Expanded(
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 3),
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
            color: AppPalette.of(context).up.withValues(alpha: 0.05),
            borderRadius: BorderRadius.circular(8)),
        child: Column(
          children: [
            Text(fmtNum(value, digits: 0),
                style: TextStyle(
                    fontSize: 17, fontWeight: FontWeight.w700, color: color)),
            const SizedBox(height: 4),
            Text(label,
                style: const TextStyle(fontSize: 11, color: Colors.grey)),
          ],
        ),
      ),
    );
  }
}
