import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:dio/dio.dart';

import 'core/config.dart';
import 'core/api_client.dart';
import 'core/auth.dart';
import 'core/theme.dart';
import 'data/api.dart';
import 'data/sources.dart';
import 'features/app_shell.dart';
import 'services/collector_service.dart';
import 'state/providers.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: HangqingApp()));
}

class HangqingApp extends ConsumerWidget {
  const HangqingApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);
    return MaterialApp(
      title: '股市脉搏',
      theme: buildLightTheme(),
      darkTheme: buildDarkTheme(),
      themeMode: themeMode,
      home: const CollectorBootstrap(),
    );
  }
}

/// 启动引导：注册鉴权 + 后台采集（不阻塞首屏）。
class CollectorBootstrap extends StatefulWidget {
  const CollectorBootstrap({super.key});
  @override
  State<CollectorBootstrap> createState() => _CollectorBootstrapState();
}

class _CollectorBootstrapState extends State<CollectorBootstrap> {
  bool _ready = false;
  String? _error;

  Future<void> _bootstrap() async {
    try {
      final dio = Dio(BaseOptions(baseUrl: AppConfig.apiBase));
      final auth = DeviceAuth(dio, const FlutterSecureStorage());
      final client = ApiClient(dio, auth);
      final source = MarketSource(dio);
      final api = MarketApi(client);
      final collector = CollectorService(api, source);
      await auth.ensureToken();
      await collector.ensureRealtime().catchError((Object _) => null);
      if (mounted) setState(() => _ready = true);
    } catch (e) {
      if (mounted) setState(() { _ready = true; _error = '初始化失败：$e'; });
    }
  }

  @override
  void initState() { super.initState(); _bootstrap(); }

  @override
  Widget build(BuildContext context) {
    if (!_ready) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (_error != null) {
      return Scaffold(appBar: AppBar(title: const Text('股市脉搏')),
        body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!))));
    }
    return const AppShell();
  }
}
