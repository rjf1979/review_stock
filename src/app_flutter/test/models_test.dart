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

    test('盘口异动支持嵌套 categories 结构', () {
      final snapshot = RealtimeSnapshot.fromJson(const {
        'indices': <Map<String, dynamic>>[],
        'pankou': {
          'categories': [
            {
              'label': '快速拉升',
              'events': [
                {'time': '10:19:00', 'name': '示例股票'},
              ],
            },
          ],
        },
      });

      expect(snapshot.pankou.single.time, '10:19:00');
      expect(snapshot.pankou.single.text, '快速拉升 示例股票');
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
  });
}
