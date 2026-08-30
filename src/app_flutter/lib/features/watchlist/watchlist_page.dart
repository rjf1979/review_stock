import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../data/models.dart';
import '../../state/providers.dart';
import '../kline/kline_page.dart';

/// 自选股：输入添加 → 报价列表 → 点行看 K 线。
class WatchlistPage extends ConsumerStatefulWidget {
  const WatchlistPage({super.key});
  @override
  ConsumerState<WatchlistPage> createState() => _WatchlistPageState();
}

class _WatchlistPageState extends ConsumerState<WatchlistPage> {
  final _codeCtrl = TextEditingController();

  /// 归一化：600519 / sh600519 → sh600519。
  static String? normalizeCode(String raw) {
    var c = raw.trim().toLowerCase();
    if (c.isEmpty) return null;
    if (RegExp(r'^(sh|sz|bj)\d{6}$').hasMatch(c)) return c;
    if (RegExp(r'^\d{6}$').hasMatch(c)) {
      if (c.startsWith('6')) return 'sh$c';
      if (c.startsWith('8') || c.startsWith('4')) return 'bj$c';
      return 'sz$c';
    }
    return null;
  }

  void _add() {
    final code = normalizeCode(_codeCtrl.text);
    if (code == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('代码不合法')));
      return;
    }
    final list = ref.read(watchlistProvider);
    if (!list.contains(code)) ref.read(watchlistProvider.notifier).state = [...list, code];
    _codeCtrl.clear();
  }

  void _remove(String code) {
    final list = ref.read(watchlistProvider).where((c) => c != code).toList();
    ref.read(watchlistProvider.notifier).state = list;
  }

  @override
  Widget build(BuildContext context) {
    final stocks = ref.watch(stocksProvider);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _codeCtrl,
                  decoration: const InputDecoration(
                    hintText: '输入代码，如 600519 / sh600519',
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                  onSubmitted: (_) => _add(),
                ),
              ),
              const SizedBox(width: 8),
              ElevatedButton(onPressed: _add, child: const Text('添加')),
            ],
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () async => ref.invalidate(stocksProvider),
            child: stocks.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text('加载失败：$e')),
              data: (list) => list.isEmpty ? _empty() : _list(list),
            ),
          ),
        ),
        const Padding(
          padding: EdgeInsets.only(bottom: 8),
          child: Text('自选保存在本机；报价来自公开行情源，仅供参考。',
              style: TextStyle(fontSize: 11, color: Colors.grey)),
        ),
      ],
    );
  }

  Widget _empty() {
    return const Center(child: Text('暂无自选，输入代码添加'));
  }

  Widget _list(List<Stock> list) {
    return ListView.separated(
      itemCount: list.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final q = list[i];
        return ListTile(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => KlinePage(code: q.code, name: q.name)),
          ),
          title: Text(q.name),
          subtitle: Text(q.code, style: const TextStyle(fontSize: 11, color: Colors.grey)),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(fmtNum(q.price), style: TextStyle(color: pctColor(context,q.changePct), fontWeight: FontWeight.w600)),
                  Text(pctText(q.changePct), style: TextStyle(fontSize: 12, color: pctColor(context,q.changePct))),
                ],
              ),
              IconButton(
                icon: const Icon(Icons.close, size: 18, color: Colors.grey),
                onPressed: () => _remove(q.code),
              ),
            ],
          ),
        );
      },
    );
  }
}
