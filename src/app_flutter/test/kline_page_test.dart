import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hangqing_app/data/models.dart';
import 'package:hangqing_app/features/kline/kline_page.dart';
import 'package:hangqing_app/state/providers.dart';

const _points = [
  KlinePoint(
      date: '2026-08-31',
      open: 1230,
      high: 1245,
      low: 1225,
      close: 1240,
      volume: 30000),
  KlinePoint(
      date: '2026-09-01',
      open: 1241,
      high: 1260,
      low: 1238,
      close: 1252,
      volume: 32000),
];

void main() {
  testWidgets('K线页渲染收盘价、蜡烛图和成交量', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          klineProvider('sh600519')
              .overrideWith((ref) => Future.value(_points)),
        ],
        child: const MaterialApp(
          home: KlinePage(code: 'sh600519', name: '贵州茅台'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('1252.00'), findsOneWidget);
    expect(find.text('日 K · 前复权'), findsOneWidget);
    expect(find.byType(CustomPaint), findsAtLeastNWidgets(2));
    expect(find.textContaining('2个交易日', skipOffstage: false), findsOneWidget);
  });

  testWidgets('K线缺失时显示空态', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          klineProvider('sh600519')
              .overrideWith((ref) => Future.value(const [])),
        ],
        child: const MaterialApp(
          home: KlinePage(code: 'sh600519', name: '贵州茅台'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('暂无 K 线数据'), findsOneWidget);
  });
}
