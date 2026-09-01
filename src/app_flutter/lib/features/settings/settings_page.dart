import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/providers.dart';

/// 设置：外观、实时刷新频率，及免责声明。
class SettingsPage extends ConsumerWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);
    final refreshSeconds = ref.watch(refreshIntervalProvider);
    final theme = Theme.of(context);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _SettingsSection(
          icon: Icons.palette_outlined,
          title: '外观',
          child: SegmentedButton<ThemeMode>(
            segments: const [
              ButtonSegment(
                  value: ThemeMode.system,
                  icon: Icon(Icons.settings_brightness),
                  label: Text('跟随')),
              ButtonSegment(
                  value: ThemeMode.light,
                  icon: Icon(Icons.light_mode),
                  label: Text('亮')),
              ButtonSegment(
                  value: ThemeMode.dark,
                  icon: Icon(Icons.dark_mode),
                  label: Text('暗')),
            ],
            selected: {themeMode},
            onSelectionChanged: (selection) =>
                ref.read(themeModeProvider.notifier).state = selection.first,
          ),
        ),
        const SizedBox(height: 12),
        _SettingsSection(
          icon: Icons.speed_outlined,
          title: '实时刷新',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text('刷新间隔', style: theme.textTheme.titleSmall),
                  const Spacer(),
                  _RefreshValue(seconds: refreshSeconds),
                ],
              ),
              const SizedBox(height: 4),
              Text('仅在前台自动刷新，切到后台自动暂停。', style: theme.textTheme.bodySmall),
              const SizedBox(height: 12),
              _RefreshIntervalSelector(selected: refreshSeconds),
            ],
          ),
        ),
        const SizedBox(height: 12),
        _SettingsSection(
          icon: Icons.info_outline,
          title: '关于',
          child: Text('数据来自公开行情源，仅供参考，不构成投资建议。红涨绿跌。',
              style: theme.textTheme.bodySmall),
        ),
        const SizedBox(height: 16),
        Text('行情只使用公开接口与确定性计算（沿用桌面版合规红线），温度/情绪为统计指标、不上引、不做买卖判断。',
            style: theme.textTheme.bodySmall),
      ],
    );
  }
}

class _RefreshIntervalSelector extends ConsumerStatefulWidget {
  const _RefreshIntervalSelector({required this.selected});

  final int selected;

  @override
  ConsumerState<_RefreshIntervalSelector> createState() =>
      _RefreshIntervalSelectorState();
}

class _RefreshIntervalSelectorState
    extends ConsumerState<_RefreshIntervalSelector> {
  int? _preview;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final seconds = _preview ?? widget.selected;

    return Column(
      children: [
        Semantics(
          label: '实时刷新频率选择',
          child: SliderTheme(
            data: SliderTheme.of(context).copyWith(
              activeTrackColor: theme.colorScheme.primary,
              inactiveTrackColor: theme.colorScheme.outlineVariant,
              thumbColor: theme.colorScheme.primary,
              overlayColor: theme.colorScheme.primary.withValues(alpha: 0.12),
              trackHeight: 3,
              thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 7),
              overlayShape: const RoundSliderOverlayShape(overlayRadius: 18),
              tickMarkShape: SliderTickMarkShape.noTickMark,
              showValueIndicator: ShowValueIndicator.never,
            ),
            child: Slider(
              value: seconds.toDouble(),
              min: 5,
              max: 60,
              divisions: 11,
              semanticFormatterCallback: (value) => '${value.round()} 秒',
              onChanged: (value) => setState(() => _preview = value.round()),
              onChangeEnd: (value) {
                final next = value.round();
                setState(() => _preview = null);
                ref.read(refreshIntervalProvider.notifier).setInterval(next);
              },
            ),
          ),
        ),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('5 秒', style: theme.textTheme.bodySmall),
            Text('60 秒', style: theme.textTheme.bodySmall),
          ],
        ),
      ],
    );
  }
}

class _RefreshValue extends StatelessWidget {
  const _RefreshValue({required this.seconds});

  final int seconds;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      liveRegion: true,
      label: '当前刷新间隔 $seconds 秒',
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: theme.colorScheme.primaryContainer,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          '$seconds 秒',
          style: theme.textTheme.labelLarge!.copyWith(
            color: theme.colorScheme.onPrimaryContainer,
          ),
        ),
      ),
    );
  }
}

class _SettingsSection extends StatelessWidget {
  const _SettingsSection({
    required this.icon,
    required this.title,
    required this.child,
  });

  final IconData icon;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: theme.colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 20, color: theme.colorScheme.onSurfaceVariant),
              const SizedBox(width: 8),
              Text(title, style: theme.textTheme.titleMedium),
            ],
          ),
          const SizedBox(height: 16),
          child,
        ],
      ),
    );
  }
}
