import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config.dart';
import '../../state/providers.dart';

/// 设置：云端地址、设备 ID、状态信息，及免责声明。
class SettingsPage extends ConsumerWidget {
  const SettingsPage({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(statusProvider);
    final themeMode = ref.watch(themeModeProvider);
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        const ListTile(
          leading: Icon(Icons.cloud_outlined),
          title: Text('云端 API 地址'),
          subtitle: Text(AppConfig.apiBase),
        ),
        const Divider(height: 1),
        ListTile(
          leading: const Icon(Icons.palette_outlined),
          title: const Text('主题皮肤'),
          subtitle: Text(_themeModeLabel(themeMode)),
          trailing: SegmentedButton<ThemeMode>(
            segments: const [
              ButtonSegment(value: ThemeMode.system, icon: Icon(Icons.settings_brightness), label: Text('跟随')),
              ButtonSegment(value: ThemeMode.light, icon: Icon(Icons.light_mode), label: Text('亮')),
              ButtonSegment(value: ThemeMode.dark, icon: Icon(Icons.dark_mode), label: Text('暗')),
            ],
            selected: {themeMode},
            onSelectionChanged: (s) => ref.read(themeModeProvider.notifier).state = s.first,
          ),
        ),
        const Divider(height: 1),
        ListTile(
          leading: const Icon(Icons.devices_other),
          title: const Text('云端状态'),
          subtitle: Text(status.when(
            data: (r) {
              final at = r['realtimeAt'] ?? r['latestFetchAt'];
              return at == null ? '暂无采集数据' : '最近采集：$at';
            },
            error: (e, _) => '获取失败：$e',
            loading: () => '加载中…',
          )),
        ),
        const Divider(height: 1),
        ListTile(
          leading: const Icon(Icons.info_outline),
          title: const Text('关于'),
          subtitle: Text('数据来自公开行情源，仅供参考，不构成投资建议。\n红涨绿跌。', style: theme.textTheme.bodySmall),
        ),
        const SizedBox(height: 24),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 12),
          child: Text('行情只使用公开接口与确定性计算（沿用桌面版合规红线），温度/情绪为统计指标、不上引、不做买卖判断。',
              style: TextStyle(fontSize: 12, color: Colors.grey)),
        ),
      ],
    );
  }

  static String _themeModeLabel(ThemeMode m) => switch (m) {
        ThemeMode.light => '亮色',
        ThemeMode.dark => '暗色',
        ThemeMode.system => '跟随系统',
      };
}
