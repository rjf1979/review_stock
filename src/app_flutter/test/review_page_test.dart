import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:hangqing_app/data/models.dart';
import 'package:hangqing_app/features/review/review_page.dart';

const _review = ReviewDetail(
  date: '2026-09-01',
  reportMode: 'close',
  temperature: 62,
  temperatureLevel: '活跃',
  breadth: Breadth(
    status: 'ready',
    up: 3308,
    down: 1819,
    flat: 80,
    redRatio: 63.53,
    upDownRatio: 1.82,
    amount: 13491.71,
    previousTurnoverYi: 13109.69,
    turnoverChangeRate: 2.91,
    sampleCount: 5207,
    reportedCount: 5555,
    limitUp: 65,
    limitDown: 1,
    broken: 6,
  ),
  maxBoardHeight: 7,
  heightDistribution: [
    BoardHeightGroup(boardHeight: 7, count: 1, leaders: ['海鸥住工']),
  ],
  sectors: [Sector(name: '视频媒体', changePct: 20.02, mainNet: 3.24)],
  fundFlow: [Sector(name: '农林牧渔', changePct: 4.21, mainNet: 26.29)],
  limitDownStocks: [LimitUpStock(name: '风险股票', sector: '银行')],
  brokenStocks: [LimitUpStock(name: '炸板股票', sector: '房地产', brokenCount: 2)],
  news: [ReviewNews(time: '11:50', title: '示例要闻', digest: '示例摘要')],
  quality: ReviewQuality(
    status: 'partial',
    confidence: 'medium',
    missingFields: ['breadth.previous_turnover_yuan'],
  ),
  markdown: '# 市场温度\n\n- 固定规则生成',
);

void main() {
  testWidgets('复盘页展示PC端核心分区且375宽度不溢出', (tester) async {
    tester.view.physicalSize = const Size(375, 1600) * 3;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: ReviewBody(review: _review))),
    );
    await tester.pump();

    expect(find.text('市场温度 / 100'), findsOneWidget);
    expect(find.text('全市场宽度'), findsOneWidget);
    expect(find.text('63.5% 红盘率'), findsOneWidget);
    expect(find.textContaining('昨日成交额'), findsOneWidget);
    expect(find.textContaining('环比'), findsOneWidget);
    expect(find.text('连板梯队'), findsOneWidget);
    expect(find.text('7板'), findsNWidgets(2));
    expect(find.text('海鸥住工'), findsOneWidget);
    expect(find.text('视频媒体'), findsOneWidget);
    expect(find.text('农林牧渔'), findsOneWidget);
    expect(find.text('示例要闻'), findsOneWidget);
    expect(find.text('上个交易日成交额'), findsOneWidget);
    expect(find.text('复盘正文'), findsNothing);
    expect(find.byType(LinearProgressIndicator), findsNWidgets(4));
  });
}
