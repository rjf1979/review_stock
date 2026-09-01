import 'dart:convert';

import 'package:dio/dio.dart';

/// 上游公开行情源抓取（复刻 PC 端 `review-core.js` 的取数）。
///
/// 骨架版仅实现东财 UTF-8 的最小抓取作为结构示例。完整端口需：
/// - 腾讯 `qt.gtimg.cn/q` 返回 GBK，需 gbk 解码（dart 无内置 GBK，需引入 codec）。
/// - 与 PC 端字段映射/缩放逐项对齐后再上线（避免同一时间桶内数据口径不一致）。
class MarketSource {
  MarketSource(this._dio);

  final Dio _dio;

  /// 三大指数（东财 push2 ulist，UTF-8）。返回 [{'code','name','price','changePct'}]。
  /// 字段：f2=最新价 f3=涨跌幅 f12=代码 f14=名称。TODO: 与 PC 端口径对齐。
  Future<List<Map<String, dynamic>>> fetchIndices() async {
    final res = await _dio.get<dynamic>(
      'https://push2.eastmoney.com/api/qt/ulist.np/get',
      queryParameters: {
        'secids': '1.000001,0.399001,0.399006',
        'fields': 'f2,f3,f12,f14',
        'fltt': '2',
        'invt': '2',
      },
    );
    final payload = _jsonPayload(res.data);
    final diff = (payload['data']?['diff'] as List?) ?? const [];
    return diff.whereType<Map<String, dynamic>>().map((m) {
      return {
        'code': '${m['f12'] ?? ''}',
        'name': '${m['f14'] ?? ''}',
        'close': (m['f2'] as num?)?.toDouble(),
        'changePct': (m['f3'] as num?)?.toDouble(),
      };
    }).toList();
  }

  /// 个股报价（东财 push2 stock/get）。TODO: 与 PC 端 quotes 源对齐。
  Future<List<Map<String, dynamic>>> fetchQuotes(List<String> codes) async {
    final out = <Map<String, dynamic>>[];
    for (final code in codes) {
      final res = await _dio.get<dynamic>(
        'https://push2.eastmoney.com/api/qt/stock/get',
        queryParameters: {
          'secid': _secid(code),
          'fields': 'f43,f57,f58,f170',
          'fltt': '2',
          'invt': '2',
        },
      );
      final payload = _jsonPayload(res.data);
      final d = payload['data'] as Map<String, dynamic>?;
      if (d == null) continue;
      out.add({
        'code': code,
        'name': '${d['f58'] ?? ''}',
        'price': (d['f43'] as num?)?.toDouble(),
        'changePct': (d['f170'] as num?)?.toDouble(),
      });
    }
    return out;
  }

  /// 日 K。TODO: 复刻 PC 端 `web.ifzq.gtimg.cn/.../fqkline/get` 的完整实现。
  Future<List<Map<String, dynamic>>> fetchKline(String code) async {
    final symbol = code.toLowerCase();
    final now = DateTime.now().toUtc().add(const Duration(hours: 8));
    final end = _isoDate(now);
    final start = _isoDate(now.subtract(const Duration(days: 120)));
    final res = await _dio.get<dynamic>(
      'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=$symbol,day,$start,$end,60,qfq',
      options: Options(headers: {'User-Agent': 'Mozilla/5.0'}),
    );
    final payload = _jsonPayload(res.data);
    final data = payload['data'];
    final node = data is Map ? data[symbol] : null;
    final rows = node is Map ? (node['qfqday'] ?? node['day']) : null;
    if (rows is! List) return const [];

    return rows
        .whereType<List>()
        .where((row) => row.length >= 6)
        .map((row) {
          return <String, dynamic>{
            'date': '${row[0] ?? ''}',
            'open': _num(row[1]),
            'close': _num(row[2]),
            'high': _num(row[3]),
            'low': _num(row[4]),
            'volume': _num(row[5]),
          };
        })
        .where((item) =>
            item['open'] != null &&
            item['close'] != null &&
            item['high'] != null &&
            item['low'] != null)
        .toList();
  }

  String _secid(String code) {
    final symbol = code.toLowerCase().replaceFirst(RegExp(r'^(sh|sz|bj)'), '');
    if (symbol.startsWith('6') || symbol.startsWith('9')) return '1.$symbol';
    return '0.$symbol';
  }

  Map<String, dynamic> _jsonPayload(Object? data) {
    if (data is Map<String, dynamic>) return data;
    if (data is String) return jsonDecode(data) as Map<String, dynamic>;
    throw StateError('行情源返回格式异常');
  }

  double? _num(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  String _isoDate(DateTime value) {
    return '${value.year}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
  }
}
