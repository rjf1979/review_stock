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
    baseUrl: const String.fromEnvironment('MAPI_URL', defaultValue: 'https://api.dailystock.askcode.cn'),
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 20),
  ));
});

final secureStorageProvider = Provider<FlutterSecureStorage>((ref) => const FlutterSecureStorage());
final authProvider = Provider<DeviceAuth>((ref) => DeviceAuth(ref.watch(dioProvider), ref.watch(secureStorageProvider)));
final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(ref.watch(dioProvider), ref.watch(authProvider)));
final marketApiProvider = Provider<MarketApi>((ref) => MarketApi(ref.watch(apiClientProvider)));
final marketSourceProvider = Provider<MarketSource>((ref) => MarketSource(ref.watch(dioProvider)));
final collectorProvider = Provider<CollectorService>((ref) =>
    CollectorService(ref.watch(marketApiProvider), ref.watch(marketSourceProvider)));

/// 实时快照
final realtimeProvider = FutureProvider<RealtimeSnapshot>((ref) async {
  final j = await ref.watch(marketApiProvider).realtime();
  return RealtimeSnapshot.fromJson(j);
});

/// 复盘列表
final reviewsProvider = FutureProvider<List<ReviewEntry>>((ref) async {
  return ref.watch(marketApiProvider).reviews();
});

/// 最新复盘（无 date 参数时回退到列表首日）
final reviewProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final api = ref.watch(marketApiProvider);
  try {
    return await api.review(_today());
  } on DioException {
    final entries = await api.reviews();
    if (entries.isEmpty) return <String, dynamic>{};
    return api.review(entries.first.date);
  }
});

/// 指定日期复盘（历史进入）
final reviewByDateProvider = FutureProvider.family<Map<String, dynamic>, String>((ref, date) async {
  return ref.watch(marketApiProvider).review(date);
});

/// 龙虎榜（默认今天）
final dragonProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return ref.watch(marketApiProvider).dragon(_today());
});

/// 状态（设置页）
final statusProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return ref.watch(marketApiProvider).status();
});

/// 自选股代码（本地存储）
final watchlistProvider = StateProvider<List<String>>((ref) => const []);

/// 自选股报价
final stocksProvider = FutureProvider<List<Stock>>((ref) async {
  final codes = ref.watch(watchlistProvider);
  if (codes.isEmpty) return const [];
  final j = await ref.watch(marketApiProvider).stocks(codes);
  final list = (j['stocks'] as List?) ?? const [];
  return list.whereType<Map<String, dynamic>>().map(Stock.fromJson).toList();
});

/// 主题模式（明/暗/跟随系统），设置页可切换。默认跟随系统。
final themeModeProvider = StateProvider<ThemeMode>((ref) => ThemeMode.system);

String _today() {
  final n = DateTime.now();
  return '${n.year}-${n.month.toString().padLeft(2, '0')}-${n.day.toString().padLeft(2, '0')}';
}
