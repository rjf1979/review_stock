import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/status_views.dart';
import '../../data/models.dart';
import '../review/review_page.dart';
import '../../state/providers.dart';

/// 历史报告：复盘日期列表 → 点开看详情。
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
                itemCount: list.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, i) => _item(context, list[i]),
              ),
      ),
    );
  }

  Widget _item(BuildContext context, ReviewEntry e) {
    return ListTile(
      title: Text(e.date),
      subtitle: Text(e.reportMode == 'close' ? '收盘复盘' : '午间快照',
          style: const TextStyle(fontSize: 12, color: Colors.grey)),
      trailing: e.temperature != null
          ? Text('${e.temperature}°',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))
          : null,
      onTap: () async {
        // 点开某个历史报告 → 复用复盘详情，临时按日期加载。
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => _ReviewDetail(date: e.date)),
        );
      },
    );
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
