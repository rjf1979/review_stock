import 'package:flutter/material.dart';

/// 个股 K 线页。
///
/// 骨架版：展示基本信息占位。完整 K 线图后续引入 chart 库绘制
/// `GET /api/kline?code=&date=`（返回 `{kline:[...]}`），
/// 数据由 PC / 众包设备上传到云端。
class KlinePage extends StatelessWidget {
  const KlinePage({super.key, required this.code, this.name = ''});
  final String code;
  final String name;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text('$name  ${code.toUpperCase()}')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.show_chart, size: 64, color: Colors.grey),
              const SizedBox(height: 16),
              Text('K 线功能开发中', style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              Text('数据经云端行情 API 下发（PC/众包设备采集），\n接入图表库后在此绘制。',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodySmall?.copyWith(color: Colors.grey)),
            ],
          ),
        ),
      ),
    );
  }
}
