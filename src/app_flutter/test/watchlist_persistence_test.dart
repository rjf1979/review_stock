import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:hangqing_app/data/models.dart';
import 'package:hangqing_app/state/providers.dart';

class _MemoryStore implements KeyValueStore {
  _MemoryStore([Map<String, String>? initial]) : values = initial ?? {};

  final Map<String, String> values;

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async {
    values[key] = value;
  }
}

void main() {
  test('自选股初始化时恢复本机数据并保存增删结果', () async {
    final storage = _MemoryStore({
      'watchlist_codes': jsonEncode(['sh600519']),
    });
    final controller = WatchlistController(storage);
    await Future<void>.delayed(Duration.zero);

    expect(controller.state, const ['sh600519']);

    await controller.add('sh600519');
    await controller.add('sz000001');
    await controller.remove('sh600519');

    expect(controller.state, const ['sz000001']);
    expect(
      storage.values['watchlist_codes'],
      jsonEncode(const ['sz000001']),
    );
  });

  test('历史复盘温度兼容数字与对象格式', () {
    final entry = ReviewEntry.fromJson(const {
      'date': '2026-09-01',
      'temperature': {'score': 62},
    });

    expect(entry.temperature, 62);
    expect(
        ReviewEntry.fromJson(const {
          'date': '2026-09-01',
          'temperature': 62,
        }).temperature,
        62);
  });
}
