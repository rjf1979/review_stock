import '../core/api_client.dart';
import 'models.dart';

/// 云端行情 API 仓储：读只读、写走采集上传。
class MarketApi {
  MarketApi(this._client);

  final ApiClient _client;

  Future<Map<String, dynamic>> realtime() => _client.get('/api/realtime');
  Future<Map<String, dynamic>> status() => _client.get('/api/status');

  Future<List<ReviewEntry>> reviews() async {
    final j = await _client.get('/api/reviews');
    final entries = (j['entries'] as List?) ?? const [];
    return entries
        .whereType<Map<String, dynamic>>()
        .map(ReviewEntry.fromJson)
        .toList();
  }

  Future<Map<String, dynamic>> review(String date) => _client.get('/api/review', query: {'date': date});
  Future<Map<String, dynamic>> dragon(String date) => _client.get('/api/dragon', query: {'date': date});
  Future<Map<String, dynamic>> stocks(List<String> codes) => _client.get('/api/stocks', query: {'codes': codes.join(',')});
  Future<Map<String, dynamic>> kline(String code, {String? date}) =>
      _client.get('/api/kline', query: {'code': code, if (date != null) 'date': date});

  Future<Map<String, dynamic>> collectReview(Object data) => _client.upload('/collect/review', data: data);
  Future<Map<String, dynamic>> collectDragon(Object data) => _client.upload('/collect/dragon', data: data);
  Future<Map<String, dynamic>> collectKline(Object data) => _client.upload('/collect/kline', data: data);
  Future<Map<String, dynamic>> collectRealtime(Object data) => _client.upload('/collect/realtime', data: data);
  Future<Map<String, dynamic>> collectQuotes(Object data) => _client.upload('/collect/quotes', data: data);
  Future<Map<String, dynamic>> heartbeat(Object data) => _client.upload('/collect/heartbeat', data: data);
}
