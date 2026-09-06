import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:hangqing_app/data/models.dart';
import 'package:hangqing_app/features/history/history_page.dart';
import 'package:hangqing_app/state/providers.dart';

void main() {
  const entries = [
    ReviewEntry(
      date: '2026-09-01',
      temperature: 62,
      temperatureLevel: '活跃',
      reportMode: 'close',
      limitUpCount: 65,
      limitDownCount: 1,
      up: 3308,
      flat: 80,
      down: 1819,
    ),
    ReviewEntry(
      date: '2026-08-29',
      reportMode: 'morning',
    ),
  ];

  testWidgets('历史页对齐PC卡片布局且375宽度不溢出', (tester) async {
    tester.view.physicalSize = const Size(375, 1400) * 3;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          reviewsProvider.overrideWith((ref) async => entries),
        ],
        child: const MaterialApp(home: Scaffold(body: HistoryPage())),
      ),
    );
    await tester.pumpAndSettle();

    // 头部：日期 + 报告模式
    expect(find.text('2026-09-01'), findsOneWidget);
    expect(find.text('收盘'), findsOneWidget);
    // 温度框：分数 + 等级 + 涨跌停
    expect(find.text('市场温度'), findsNWidgets(2));
    expect(find.text('62'), findsOneWidget);
    expect(find.text('活跃'), findsOneWidget);
    expect(find.text('涨停'), findsNWidgets(2));
    expect(find.text('65'), findsOneWidget);
    expect(find.text('跌停'), findsNWidgets(2));
    expect(find.text('1'), findsOneWidget);
    // 宽度行 + 查看动作
    expect(find.text('上涨'), findsNWidgets(2));
    expect(find.text('3308'), findsOneWidget);
    expect(find.text('平盘'), findsNWidgets(2));
    expect(find.text('80'), findsOneWidget);
    expect(find.text('下跌'), findsNWidgets(2));
    expect(find.text('1819'), findsOneWidget);
    expect(find.text('查看复盘'), findsNWidgets(2));

    // 字段缺失的老条目回退占位符，不渲染等级。
    expect(find.text('2026-08-29'), findsOneWidget);
    expect(find.text('—'), findsNWidgets(6));
    expect(tester.takeException(), isNull);
  });

  testWidgets('历史页空列表展示空态', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          reviewsProvider.overrideWith((ref) async => const []),
        ],
        child: const MaterialApp(home: Scaffold(body: HistoryPage())),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('暂无历史复盘报告'), findsOneWidget);
  });
}
