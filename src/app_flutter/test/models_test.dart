import 'package:flutter_test/flutter_test.dart';

import 'package:hangqing_app/data/models.dart';

void main() {
  group('行情模型线上契约', () {
    test('指数使用 close 作为价格兼容字段', () {
      final index = IndexQuote.fromJson(const {
        'name': '上证指数',
        'close': 3946.4,
        'changePct': -0.15,
        'amountYi': 4390.37,
      });

      expect(index.price, 3946.4);
      expect(index.amount, 4390.37);
    });

    test('实时快照兼容 PC 版盘面分区', () {
      final snapshot = RealtimeSnapshot.fromJson(const {
        'indices': <Map<String, dynamic>>[],
        'breadth': {
          'status': 'ready',
          'up': 2737,
          'down': 1948,
          'flat': 85,
          'redRatio': 57.38,
          'upDownRatio': 1.41,
          'turnoverYi': 19143.32,
          'broken': 6,
          'topGainers': [
            {
              'code': '601123',
              'name': '示例股票',
              'close': 25.95,
              'changePct': 10.02,
              'amountYi': 19.48,
            },
          ],
        },
        'fallingSectors': [
          {'name': '通信设备', 'changePct': -2.1, 'inflowYi': -18.2},
        ],
        'fundFlow': [
          {'name': '电源设备', 'changePct': 1.2, 'inflowYi': 26.3},
        ],
        'limitDownStocks': [
          {'code': '000001', 'name': '风险股票', 'sector': '银行'},
        ],
        'brokenStocks': [
          {
            'code': '000002',
            'name': '炸板股票',
            'sector': '房地产',
            'brokenCount': 2,
          },
        ],
        'limitUpCount': 83,
        'limitDownCount': 1,
        'brokenCount': 6,
        'marketSession': {'isTrading': true, 'label': '交易中'},
        'asOfDate': '2026-09-01',
      });

      expect(snapshot.breadth.redRatio, 57.38);
      expect(snapshot.breadth.broken, 6);
      expect(snapshot.topGainers.single.name, '示例股票');
      expect(snapshot.topGainers.single.amountYi, 19.48);
      expect(snapshot.fallingSectors.single.mainNet, -18.2);
      expect(snapshot.fundFlow.single.mainNet, 26.3);
      expect(snapshot.limitDownStocks.single.name, '风险股票');
      expect(snapshot.brokenStocks.single.brokenCount, 2);
      expect(snapshot.marketSession?.label, '交易中');
    });

    test('K线兼容腾讯接口返回的字符串数字', () {
      final point = KlinePoint.fromJson(const {
        'date': '2026-09-01',
        'open': '1240.10',
        'close': '1252.50',
        'high': '1260.00',
        'low': '1235.20',
        'volume': '30828',
      });

      expect(point.date, '2026-09-01');
      expect(point.open, 1240.10);
      expect(point.close, 1252.50);
      expect(point.high, 1260.00);
      expect(point.low, 1235.20);
      expect(point.volume, 30828);
    });

    test('复盘模型兼容云端扁平对象与温度等级', () {
      final review = ReviewDetail.fromJson(const {
        'date': '2026-09-01',
        'meta': {'report_mode': 'intraday'},
        'temperature': {'score': 62, 'level': '活跃', 'zone': '活跃'},
        'breadth': {
          'status': 'ready',
          'up': 3308,
          'down': 1819,
          'flat': 80,
          'redRatio': 63.53,
          'upDownRatio': 1.82,
          'turnoverYi': 13491.71,
          'limitUp': 65,
          'limitDown': 1,
          'broken': 6,
        },
        'sentiment': {
          'maxBoardHeight': 7,
          'promotionSuccessCount': 8,
          'promotionBaseCount': 20,
          'promotionRate': 0.4,
          'sealRate': 0.915,
        },
        'heightDistribution': [
          {'boardHeight': 7, 'count': 1, 'leaders': ['海鸥住工']},
        ],
        'sectors': [
          {'name': '视频媒体', 'changePct': 20.02, 'inflowYi': 3.24},
        ],
        'fundFlow': [
          {'name': '农林牧渔', 'changePct': 4.21, 'inflowYi': 26.29},
        ],
        'limitDownStocks': [
          {'code': '000001', 'name': '风险股票', 'sector': '银行'},
        ],
        'brokenStocks': [
          {'code': '000002', 'name': '炸板股票', 'sector': '房地产', 'brokenCount': 2},
        ],
        'news': [
          {'time': '11:50', 'title': '示例要闻', 'digest': '示例摘要'},
        ],
        'quality': {
          'status': 'partial',
          'confidence': 'medium',
          'missingFields': ['breadth.previous_turnover_yuan'],
        },
        'markdown': '# 示例复盘',
      });

      expect(review.temperature, 62);
      expect(review.temperatureLevel, '活跃');
      expect(review.breadth.redRatio, 63.53);
      expect(review.maxBoardHeight, 7);
      expect(review.promotionRate, 0.4);
      expect(review.heightDistribution.single.leaders.single, '海鸥住工');
      expect(review.sectors.single.mainNet, 3.24);
      expect(review.fundFlow.single.mainNet, 26.29);
      expect(review.limitDownStocks.single.name, '风险股票');
      expect(review.brokenStocks.single.brokenCount, 2);
      expect(review.news.single.title, '示例要闻');
      expect(review.quality.missingFields.single, 'breadth.previous_turnover_yuan');
    });

    test('复盘模型兼容旧版 payload 嵌套契约', () {
      final review = ReviewDetail.fromJson(const {
        'date': '2026-09-01',
        'temperature': {'score': 50},
        'payload': {
          'markdown': '## 正文',
          'breadth': {'up': 100},
        },
      });

      expect(review.temperature, 50);
      expect(review.breadth.up, 100);
      expect(review.markdown, '## 正文');
    });
  });
}
