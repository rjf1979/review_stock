import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../../state/providers.dart';

/// 龙虎榜：上榜记录（含买卖席位），展开看前五席位。
class DragonPage extends ConsumerWidget {
  const DragonPage({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dragon = ref.watch(dragonProvider);
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(dragonProvider),
      child: dragon.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ListView(children: [const SizedBox(height: 120), Center(child: Text('加载失败：$e'))]),
        data: (r) => _body(context, r),
      ),
    );
  }

  Widget _body(BuildContext context, Map<String, dynamic> r) {
    final theme = Theme.of(context);
    final date = '${r['date'] ?? '--'}';
    final list = (r['list'] as List?)?.whereType<Map<String, dynamic>>().map(DragonItem.fromJson).toList() ?? [];
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Text('$date · ${list.length} 条上榜记录', style: theme.textTheme.bodySmall?.copyWith(color: Colors.grey)),
        ),
        if (list.isEmpty)
          const Padding(padding: EdgeInsets.all(24), child: Text('暂无龙虎榜数据', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)))
        else
          ...list.map((e) => _item(context, theme, e)),
        const SizedBox(height: 8),
        const Text('机构身份仅按公开席位名称标注，其他资金方显示具体证券营业部。涨停板统计性描述，仅供参考。',
            style: TextStyle(fontSize: 11, color: Colors.grey)),
      ],
    );
  }

  Widget _item(BuildContext context, ThemeData theme, DragonItem d) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ExpansionTile(
        title: Row(
          children: [
            Expanded(child: Text(d.name, style: const TextStyle(fontWeight: FontWeight.w600))),
            Text(pctText(d.changePct), style: TextStyle(color: pctColor(context, d.changePct))),
          ],
        ),
        subtitle: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            children: [
              _mini('买', d.buy, AppPalette.of(context).up),
              const SizedBox(width: 16),
              _mini('卖', d.sell, AppPalette.of(context).down),
              const SizedBox(width: 16),
              _mini('净', d.netBuy, d.netBuy != null && d.netBuy! >= 0 ? AppPalette.of(context).up : AppPalette.of(context).down),
            ],
          ),
        ),
        children: [
          Divider(height: 1, color: theme.dividerColor),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(d.reason.isEmpty ? '上榜原因未披露' : d.reason,
                style: const TextStyle(fontSize: 12, color: Colors.grey)),
          ),
          if (d.buyers.isNotEmpty) _seatTable(context, theme, '买入前五席位', d.buyers),
          if (d.sellers.isNotEmpty) _seatTable(context, theme, '卖出前五席位', d.sellers),
        ],
      ),
    );
  }

  Widget _mini(String label, double? value, Color color) {
    return Row(
      children: [
        Text(label, style: const TextStyle(fontSize: 11, color: Colors.grey)),
        const SizedBox(width: 4),
        Text(fmtWan(value), style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: color)),
      ],
    );
  }

  Widget _seatTable(BuildContext context, ThemeData theme, String title, List<DragonSeat> seats) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: theme.textTheme.labelMedium?.copyWith(color: Colors.grey)),
          const SizedBox(height: 6),
          ...seats.map((s) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Expanded(
                      flex: 2,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(s.name, style: const TextStyle(fontSize: 13)),
                          Text(s.type, style: const TextStyle(fontSize: 10, color: Colors.grey)),
                        ],
                      ),
                    ),
                    Expanded(flex: 1, child: Text(fmtWan(s.buyYi), textAlign: TextAlign.right,
                        style: TextStyle(fontSize: 12, color: AppPalette.of(context).up))),
                    Expanded(flex: 1, child: Text(fmtWan(s.sellYi), textAlign: TextAlign.right,
                        style: TextStyle(fontSize: 12, color: AppPalette.of(context).down))),
                    Expanded(flex: 1, child: Text(fmtWan(s.netYi), textAlign: TextAlign.right,
                        style: TextStyle(fontSize: 12, color: s.netYi != null && s.netYi! >= 0 ? AppPalette.of(context).up : AppPalette.of(context).down))),
                  ],
                ),
              )),
        ],
      ),
    );
  }
}
