import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hangqing_app/data/models.dart';
import 'package:hangqing_app/features/realtime/realtime_page.dart';
import 'package:hangqing_app/state/providers.dart';

const _snapshot = RealtimeSnapshot(
  indices: [
    IndexQuote(name: '上证指数', price: 3979.65, changePct: -0.17),
  ],
  breadth: Breadth(
    up: 2737,
    down: 1948,
    flat: 85,
    limitUp: 83,
    limitDown: 1,
    broken: 6,
    redRatio: 57.4,
    upDownRatio: 1.41,
    amount: 19143.32,
    sampleCount: 4770,
  ),
  concepts: [Sector(name: '视频媒体', changePct: 20.02)],
  fallingConcepts: [Sector(name: '半导体', changePct: -2.16)],
  fundFlow: [Sector(name: '电源设备', changePct: 1.2, mainNet: 26.3)],
  topGainers: [
    RankStock(
      code: '601123',
      name: '示例股票',
      close: 25.95,
      changePct: 10.02,
      amountYi: 19.48,
    ),
  ],
  limitUpStocks: [
    LimitUpStock(
      code: '000001',
      name: '涨停股票',
      changePct: 10.02,
      streak: 3,
      sector: '银行',
    ),
  ],
  brokenStocks: [
    LimitUpStock(
      code: '000002',
      name: '炸板股票',
      changePct: 5.2,
      sector: '房地产',
      brokenCount: 2,
    ),
  ],
  limitUpCount: 83,
  marketSession: MarketSession(isTrading: true, label: '交易中'),
  asOfDate: '2026-09-01',
  updatedAt: '2026-09-01T07:00:00.000Z',
);

void main() {
  testWidgets('实时页展示PC盘面分区且不显示盘口异动', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          realtimeProvider.overrideWith((ref) => Future.value(_snapshot)),
        ],
        child: const MaterialApp(home: RealtimePage()),
      ),
    );
    await tester.pump();

    expect(find.text('市场雷达'), findsOneWidget);
    expect(find.text('领涨行业'), findsOneWidget);
    expect(find.text('盘口异动'), findsNothing);

    await tester.pumpWidget(const SizedBox());
    await tester.pump();
  });
}
