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
    final res = await _dio.get<Map<String, dynamic>>(
      'https://push2.eastmoney.com/api/qt/ulist.np/get',
      queryParameters: {
        'secids': '1.000001,0.399001,0.399006',
        'fields': 'f2,f3,f12,f14',
      },
    );
    final diff = (res.data?['data']?['diff'] as List?) ?? const [];
    return diff.whereType<Map<String, dynamic>>().map((m) {
      return {
        'code': '${m['f12'] ?? ''}',
        'name': '${m['f14'] ?? ''}',
        'price': (m['f2'] as num?)?.toDouble(),
        'changePct': (m['f3'] as num?)?.toDouble(),
      };
    }).toList();
  }

  /// 个股报价（东财 push2 stock/get）。TODO: 与 PC 端 quotes 源对齐。
  Future<List<Map<String, dynamic>>> fetchQuotes(List<String> codes) async {
    final out = <Map<String, dynamic>>[];
    for (final code in codes) {
      final res = await _dio.get<Map<String, dynamic>>(
        'https://push2.eastmoney.com/api/qt/stock/get',
        queryParameters: {'secid': _secid(code), 'fields': 'f43,f57,f58,f170'},
      );
      final d = res.data?['data'] as Map<String, dynamic>?;
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
    return const [];
  }

  String _secid(String code) {
    if (code.startsWith('6') || code.startsWith('9')) return '1.$code';
    return '0.$code';
  }
}
