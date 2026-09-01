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
  });
}
