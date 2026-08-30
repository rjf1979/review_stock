import 'package:flutter/material.dart';

import 'dragon/dragon_page.dart';
import 'history/history_page.dart';
import 'overview/overview_page.dart';
import 'realtime/realtime_page.dart';
import 'review/review_page.dart';
import 'settings/settings_page.dart';
import 'watchlist/watchlist_page.dart';

/// 应用壳：底部 5 Tab（实时/自选/复盘/龙虎榜/历史）+ 大盘/设置入口。
///
/// 历史、设置、大盘通过图标/按钮进入；align 保持首页清爽。
class AppShell extends StatefulWidget {
  const AppShell({super.key});
  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _index = 0;

  static const _tabs = [
    ('实时', Icons.show_chart),
    ('自选', Icons.star_outline),
    ('复盘', Icons.description_outlined),
    ('龙虎榜', Icons.list_alt),
    ('历史', Icons.history),
  ];

  @override
  Widget build(BuildContext context) {
    final index = _index;
    final page = switch (index) {
      1 => const WatchlistPage(),
      2 => const ReviewPage(),
      3 => const DragonPage(),
      4 => const HistoryPage(),
      _ => const RealtimePage(),
    };

    return Scaffold(
      appBar: AppBar(
        title: Text(_tabs[index].$1),
        actions: [
          IconButton(
            icon: const Icon(Icons.pie_chart_outline),
            tooltip: '大盘概况',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const _PushPage(title: '大盘概况', child: OverviewPage())),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: '设置',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const _PushPage(title: '设置', child: SettingsPage())),
            ),
          ),
        ],
      ),
      body: page,
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          for (final t in _tabs) NavigationDestination(icon: Icon(t.$2), label: t.$1),
        ],
      ),
    );
  }
}

class _PushPage extends StatelessWidget {
  const _PushPage({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Scaffold(appBar: AppBar(title: Text(title)), body: child);
  }
}
