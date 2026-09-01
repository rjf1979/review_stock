import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../core/api_client.dart';
import '../core/auth.dart';
import '../data/api.dart';
import '../data/models.dart';
import '../data/sources.dart';
import '../services/collector_service.dart';

final dioProvider = Provider<Dio>((ref) {
  return Dio(BaseOptions(
    baseUrl: const String.fromEnvironment('MAPI_URL',
        defaultValue: 'https://api.dailystock.askcode.cn'),
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 20),
  ));
});

final secureStorageProvider =
    Provider<FlutterSecureStorage>((ref) => const FlutterSecureStorage());
final authProvider = Provider<DeviceAuth>((ref) =>
    DeviceAuth(ref.watch(dioProvider), ref.watch(secureStorageProvider)));
final apiClientProvider = Provider<ApiClient>(
    (ref) => ApiClient(ref.watch(dioProvider), ref.watch(authProvider)));
final marketApiProvider =
    Provider<MarketApi>((ref) => MarketApi(ref.watch(apiClientProvider)));
final marketSourceProvider =
    Provider<MarketSource>((ref) => MarketSource(ref.watch(dioProvider)));
final collectorProvider = Provider<CollectorService>((ref) => CollectorService(
    ref.watch(marketApiProvider), ref.watch(marketSourceProvider)));

/// 实时页前台自动刷新频率，单位秒；本机持久化。
final refreshIntervalProvider =
    StateNotifierProvider<RefreshIntervalController, int>((ref) {
  return RefreshIntervalController(ref.watch(secureStorageProvider));
});

/// 本机小型键值存储抽象，便于状态控制器与界面测试解耦。
abstract class KeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
}

class FlutterSecureKeyValueStore implements KeyValueStore {
  FlutterSecureKeyValueStore(this._storage);

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);
}

class RefreshIntervalController extends StateNotifier<int> {
  RefreshIntervalController(this._storage) : super(60) {
    _load();
  }

  final FlutterSecureStorage _storage;
  static const _storageKey = 'realtime_refresh_seconds';

  Future<void> _load() async {
    try {
      final raw = await _storage.read(key: _storageKey);
      final value = int.tryParse(raw ?? '');
      if (value != null && isValid(value)) state = value;
    } catch (_) {
      state = 60;
    }
  }

  Future<void> setInterval(int seconds) async {
    if (!isValid(seconds)) return;
    state = seconds;
    try {
      await _storage.write(key: _storageKey, value: '$seconds');
    } catch (_) {
      state = seconds;
    }
  }

  static bool isValid(int seconds) =>
      seconds >= 5 && seconds <= 60 && seconds % 5 == 0;
}

/// 实时快照
final realtimeProvider = FutureProvider<RealtimeSnapshot>((ref) async {
  final collector = ref.watch(collectorProvider);
  try {
    await collector.ensureRealtime(maxAge: const Duration(seconds: 60));
  } catch (_) {
    // 补数失败时仍尝试读取云端最近快照。
  }
  final j = await ref.watch(marketApiProvider).realtime();
  return RealtimeSnapshot.fromJson(j);
});

/// 复盘列表
final reviewsProvider = FutureProvider<List<ReviewEntry>>((ref) async {
  try {
    return await ref.watch(marketApiProvider).reviews();
  } on DioException catch (e) {
    if (e.response?.statusCode == 404) return const [];
    rethrow;
  }
});

/// 最新复盘（无 date 参数时回退到列表首日）
final reviewProvider = FutureProvider<ReviewDetail>((ref) async {
  final api = ref.watch(marketApiProvider);
  try {
    return ReviewDetail.fromJson(await api.review(_today()));
  } on DioException catch (e) {
    if (e.response?.statusCode != 404) rethrow;
  }

  final entries = await api.reviews();
  if (entries.isEmpty) return const ReviewDetail();
  try {
    return ReviewDetail.fromJson(await api.review(entries.first.date));
  } on DioException catch (e) {
    if (e.response?.statusCode == 404) return const ReviewDetail();
    rethrow;
  }
});

/// 指定日期复盘（历史进入）
final reviewByDateProvider =
    FutureProvider.family<ReviewDetail, String>((ref, date) async {
  try {
    return ReviewDetail.fromJson(await ref.watch(marketApiProvider).review(date));
  } on DioException catch (e) {
    if (e.response?.statusCode == 404) return const ReviewDetail();
    rethrow;
  }
});

/// 龙虎榜（默认今天）
final dragonProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final api = ref.watch(marketApiProvider);
  var date = _today();
  for (var attempt = 0; attempt < 10; attempt++) {
    try {
      return await api.dragon(date);
    } on DioException catch (e) {
      if (e.response?.statusCode != 404) rethrow;
      date = _previousTradingDate(date);
    }
  }
  throw StateError('最近交易日暂无龙虎榜数据');
});

/// 状态（设置页）
final statusProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return ref.watch(marketApiProvider).status();
});

/// 自选股日 K
final klineProvider =
    FutureProvider.family<List<KlinePoint>, String>((ref, code) async {
  final rows = await ref.watch(collectorProvider).ensureKline(code);
  return rows
      .map(KlinePoint.fromJson)
      .where((point) => point.date.isNotEmpty)
      .toList();
});

/// 自选股代码（本机持久化）
final watchlistProvider =
    StateNotifierProvider<WatchlistController, List<String>>((ref) {
  return WatchlistController(ref.watch(watchlistStorageProvider));
});

final watchlistStorageProvider = Provider<KeyValueStore>((ref) {
  return FlutterSecureKeyValueStore(ref.watch(secureStorageProvider));
});

class WatchlistController extends StateNotifier<List<String>> {
  WatchlistController(this._storage) : super(const []) {
    _load();
  }

  final KeyValueStore _storage;
  static const _storageKey = 'watchlist_codes';

  Future<void> _load() async {
    try {
      final raw = await _storage.read(_storageKey);
      final decoded = raw == null ? null : jsonDecode(raw);
      if (decoded is List) {
        state = decoded
            .whereType<String>()
            .where((code) => code.isNotEmpty)
            .toList();
      }
    } catch (_) {
      // 损坏的本地数据按空自选处理，避免阻塞报价页。
    }
  }

  Future<void> add(String code) async {
    if (state.contains(code)) return;
    await _replace([...state, code]);
  }

  Future<void> remove(String code) async {
    await _replace(state.where((item) => item != code).toList());
  }

  Future<void> _replace(List<String> next) async {
    final previous = state;
    state = next;
    try {
      await _storage.write(_storageKey, jsonEncode(next));
    } catch (_) {
      state = previous;
    }
  }
}

/// 自选股报价
final stocksProvider = FutureProvider<List<Stock>>((ref) async {
  final codes = ref.watch(watchlistProvider);
  if (codes.isEmpty) return const [];
  final api = ref.watch(marketApiProvider);
  final collector = ref.watch(collectorProvider);

  Future<List<Stock>> readStocks() async {
    final j = await api.stocks(codes);
    final list = (j['stocks'] as List?) ?? const [];
    return list.whereType<Map<String, dynamic>>().map(Stock.fromJson).toList();
  }

  await collector
      .ensureQuotes(codes)
      .catchError((Object _) => <String, dynamic>{});
  try {
    final stocks = await readStocks();
    if (stocks.length >= codes.length) return stocks;

    final loaded = stocks.map((s) => s.code).toSet();
    final missing = codes.where((c) => !loaded.contains(c)).toList();
    await collector.ensureQuotes(missing, force: true);
    final refreshed = await readStocks();
    final byCode = {for (final stock in stocks) stock.code: stock};
    for (final stock in refreshed) {
      byCode[stock.code] = stock;
    }
    return codes.map((code) => byCode[code]).whereType<Stock>().toList();
  } on DioException catch (e) {
    if (e.response?.statusCode != 503) rethrow;
    await collector.ensureQuotes(codes, force: true);
    return readStocks();
  }
});

/// 主题模式（明/暗/跟随系统），设置页可切换。默认跟随系统。
final themeModeProvider = StateProvider<ThemeMode>((ref) => ThemeMode.system);

String _today() {
  final n = DateTime.now();
  return '${n.year}-${n.month.toString().padLeft(2, '0')}-${n.day.toString().padLeft(2, '0')}';
}

String _previousTradingDate(String date) {
  var day = DateTime.parse(date).subtract(const Duration(days: 1));
  while (day.weekday > DateTime.friday) {
    day = day.subtract(const Duration(days: 1));
  }
  return '${day.year}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';
}
