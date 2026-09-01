import 'package:dio/dio.dart';

import '../data/api.dart';
import '../data/sources.dart';

/// 众包采集调度器：判新鲜度 → 缺则抓源 → 上传认领。
///
/// 实现「先采集先共享」闭环：
/// - 先问云端 `/api/status` 该流是否新鲜；
/// - 缺失/过期则从公开源抓取，再走 `/collect/*`（服务端原子认领，先到先得）；
/// - 已有新鲜数据则直接读，不重复抓源。
class CollectorService {
  CollectorService(this._api, this._source);

  final MarketApi _api;
  final MarketSource _source;

  /// 是否处于连续交易时段（骨架版：仅判断工作日，未含节假日日历）。
  static bool _isTradingSession(DateTime now) {
    if (now.weekday < DateTime.monday || now.weekday > DateTime.friday) {
      return false;
    }
    final minuteOfDay = now.hour * 60 + now.minute;
    return (minuteOfDay >= 9 * 60 + 30 && minuteOfDay < 11 * 60 + 30) ||
        (minuteOfDay >= 13 * 60 && minuteOfDay < 15 * 60);
  }

  static String _today() {
    final n = DateTime.now();
    return '${n.year}-${n.month.toString().padLeft(2, '0')}-${n.day.toString().padLeft(2, '0')}';
  }

  /// ensureRealtime：确保云端有新鲜实时快照，否则本机抓取并上传。
  Future<void> ensureRealtime(
      {Duration maxAge = const Duration(minutes: 10)}) async {
    if (!_isTradingSession(DateTime.now())) return;
    final status = await _api.status();
    final at = status['realtimeAt'] as String?;
    final fresh =
        at != null && DateTime.now().difference(DateTime.parse(at)) < maxAge;
    if (fresh) return;

    final indices = await _source.fetchIndices();
    if (indices.isEmpty) return;
    final payload = {
      'indices': indices,
      'updatedAt': DateTime.now().toUtc().toIso8601String(),
      'meta': {'trade_date': _today()},
    };
    await _api.collectRealtime(payload);
  }

  /// ensureQuotes：确保自选股报价新鲜。
  Future<void> ensureQuotes(List<String> codes, {bool force = false}) async {
    if (codes.isEmpty) return;
    if (!force) {
      final status = await _api.status();
      final at = status['quotesAt'] as String?;
      final fresh = at != null &&
          DateTime.now().difference(DateTime.parse(at)).inMinutes < 10;
      if (fresh) return;
    }

    final stocks = await _source.fetchQuotes(codes);
    if (stocks.isEmpty) return;
    await _api.collectQuotes({
      'stocks': stocks,
      'updatedAt': DateTime.now().toUtc().toIso8601String(),
    });
  }

  /// ensureReview：确保当日收盘复盘已由某设备产出（先到先得）。
  Future<void> ensureReview({DateTime? when}) async {
    final date = _today();
    Map<String, dynamic> j;
    try {
      j = await _api.review(date);
    } on DioException {
      j = <String, dynamic>{}; // 404/网络错误 → 视为缺失，走认领
    }
    if (j['persisted'] == true || (j['data'] != null)) return; // 已有
    // 骨架版：复盘需要复杂聚合，暂不发完整生成；此处仅保留认领意图。
    // TODO: 复刻 PC 端 review-core 的收盘复盘聚合后调用 _api.collectReview。
  }

  /// 心跳上报，便于云端展示设备在线与数据质量。
  Future<void> reportHeartbeat({String version = '0.1.0'}) async {
    await _api.heartbeat({
      'version': version,
      'fetchedAt': DateTime.now().toUtc().toIso8601String(),
      'ok': true,
    });
  }

  Future<List<Map<String, dynamic>>> ensureKline(String code) async {
    try {
      final cached = await _api.kline(code);
      final rows = (cached['kline'] as List?) ?? const [];
      final parsed = rows
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .where((row) => row['date'] != null)
          .toList();
      if (parsed.isNotEmpty) return parsed;
    } catch (_) {
      // 云端缺失或不可用时，直接回退公开源并尝试补数。
    }

    final kline = await _source.fetchKline(code);
    if (kline.isEmpty) return const [];

    try {
      await _api.collectKline({
        'code': code,
        'latestDate': kline.last['date'],
        'isFresh': kline.last['date'] == _shanghaiToday(),
        'kline': kline,
      });
    } catch (_) {
      // 上传失败时仍允许本机渲染，下次进入可重新补数。
    }
    return kline;
  }
}

String _shanghaiToday() {
  final now = DateTime.now().toUtc().add(const Duration(hours: 8));
  return '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
}
