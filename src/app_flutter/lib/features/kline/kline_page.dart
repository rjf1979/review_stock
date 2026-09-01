import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/format.dart';
import '../../core/status_views.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../../state/providers.dart';

/// 自选股日 K 图。
class KlinePage extends ConsumerWidget {
  const KlinePage({super.key, required this.code, this.name = ''});
  final String code;
  final String name;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final kline = ref.watch(klineProvider(code));
    return Scaffold(
      appBar: AppBar(title: Text('$name  ${code.toUpperCase()}')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(klineProvider(code)),
        child: kline.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => RefreshableErrorView(
            message: friendlyErrorMessage(error),
            onRetry: () => ref.invalidate(klineProvider(code)),
          ),
          data: (points) {
            if (points.isEmpty) {
              return ListView(
                children: const [
                  SizedBox(height: 160),
                  Center(child: Text('暂无 K 线数据')),
                ],
              );
            }
            return _KlineBody(points: points);
          },
        ),
      ),
    );
  }
}

class _KlineBody extends StatelessWidget {
  const _KlineBody({required this.points});

  final List<KlinePoint> points;

  @override
  Widget build(BuildContext context) {
    final last = points.last;
    final previous = points.length > 1 ? points[points.length - 2].close : null;
    final changePct = previous == null || previous == 0
        ? null
        : (last.close - previous) / previous * 100;
    final pal = AppPalette.of(context);

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          fmtNum(last.close),
                          style: Theme.of(context)
                              .textTheme
                              .headlineSmall
                              ?.copyWith(
                                fontWeight: FontWeight.w800,
                              ),
                        ),
                        const SizedBox(height: 4),
                        Text(last.date,
                            style: Theme.of(context).textTheme.bodySmall),
                      ],
                    ),
                    Text(
                      pctText(changePct),
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                        color: pctColor(context, changePct),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    _stat(context, '开盘', fmtNum(last.open)),
                    _stat(context, '最高', fmtNum(last.high)),
                    _stat(context, '最低', fmtNum(last.low)),
                    _stat(context, '成交量', fmtWan(last.volume)),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('日 K · 前复权',
                    style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 12),
                Semantics(
                  label:
                      'K线图，包含${points.length}个交易日，最新收盘价${fmtNum(last.close)}',
                  child: CustomPaint(
                    size: const Size.fromHeight(260),
                    painter: _KlinePainter(
                      points: points,
                      up: pal.up,
                      down: pal.down,
                      grid: pal.flat.withValues(alpha: 0.24),
                      axis: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                CustomPaint(
                  size: const Size.fromHeight(72),
                  painter: _VolumePainter(
                    points: points,
                    up: pal.up,
                    down: pal.down,
                    axis: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          '展示最近${points.length}个交易日；行情来自公开源，仅供参考，不构成投资建议。',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }

  Widget _stat(BuildContext context, String label, String value) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 2),
          Text(value, style: Theme.of(context).textTheme.titleSmall),
        ],
      ),
    );
  }
}

class _KlinePainter extends CustomPainter {
  const _KlinePainter({
    required this.points,
    required this.up,
    required this.down,
    required this.grid,
    required this.axis,
  });

  final List<KlinePoint> points;
  final Color up;
  final Color down;
  final Color grid;
  final Color axis;

  @override
  void paint(Canvas canvas, Size size) {
    final chartBottom = size.height - 20;
    const labelWidth = 52.0;
    final plotRight = size.width - labelWidth;
    final lows = points.map((point) => point.low);
    final highs = points.map((point) => point.high);
    var min = lows.reduce((a, b) => a < b ? a : b);
    var max = highs.reduce((a, b) => a > b ? a : b);
    if (max == min) {
      max += 1;
      min -= 1;
    }
    final padding = (max - min) * 0.08;
    max += padding;
    min -= padding;

    for (var i = 0; i <= 3; i++) {
      final y = chartBottom * i / 3;
      final value = max - (max - min) * i / 3;
      final paint = Paint()
        ..color = grid
        ..strokeWidth = 1;
      canvas.drawLine(Offset(0, y), Offset(plotRight, y), paint);
      _label(
        canvas,
        fmtNum(value),
        Offset(plotRight + 6, y - 8),
        labelWidth,
        axis,
      );
    }

    final step = plotRight / points.length;
    final bodyWidth = (step * 0.68).clamp(2.0, 14.0).toDouble();
    final bodyPaint = Paint();
    final wickPaint = Paint()..strokeWidth = 1;

    for (var i = 0; i < points.length; i++) {
      final point = points[i];
      final x = (i + 0.5) * step;
      final yHigh = _y(point.high, min, max, chartBottom);
      final yLow = _y(point.low, min, max, chartBottom);
      final yOpen = _y(point.open, min, max, chartBottom);
      final yClose = _y(point.close, min, max, chartBottom);
      final color = point.close >= point.open ? up : down;

      canvas.drawLine(
        Offset(x, yHigh),
        Offset(x, yLow),
        wickPaint..color = color,
      );
      final top = yOpen < yClose ? yOpen : yClose;
      final height = (yClose - yOpen).abs();
      canvas.drawRect(
        Rect.fromLTWH(
          x - bodyWidth / 2,
          top,
          bodyWidth,
          height == 0 ? 1 : height,
        ),
        bodyPaint..color = color,
      );
    }

    _label(
      canvas,
      _shortDate(points.first.date),
      Offset(0, chartBottom + 6),
      56,
      axis,
    );
    _label(
      canvas,
      _shortDate(points[points.length ~/ 2].date),
      Offset(plotRight / 2 - 28, chartBottom + 6),
      56,
      axis,
    );
    _label(
      canvas,
      _shortDate(points.last.date),
      Offset(plotRight - 56, chartBottom + 6),
      56,
      axis,
    );
  }

  double _y(double value, double min, double max, double height) {
    return height * (1 - (value - min) / (max - min));
  }

  void _label(
    Canvas canvas,
    String text,
    Offset offset,
    double width,
    Color color,
  ) {
    final painter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(fontSize: 10, color: color),
      ),
      textDirection: TextDirection.ltr,
    )..layout(maxWidth: width);
    painter.paint(canvas, offset);
  }

  String _shortDate(String value) {
    final parts = value.split('-');
    return parts.length >= 3 ? '${parts[1]}-${parts[2]}' : value;
  }

  @override
  bool shouldRepaint(covariant _KlinePainter oldDelegate) {
    return oldDelegate.points != points ||
        oldDelegate.up != up ||
        oldDelegate.down != down;
  }
}

class _VolumePainter extends CustomPainter {
  const _VolumePainter({
    required this.points,
    required this.up,
    required this.down,
    required this.axis,
  });

  final List<KlinePoint> points;
  final Color up;
  final Color down;
  final Color axis;

  @override
  void paint(Canvas canvas, Size size) {
    const labelWidth = 52.0;
    final plotRight = size.width - labelWidth;
    final maxVolume =
        points.map((point) => point.volume).reduce((a, b) => a > b ? a : b);
    final safeMax = maxVolume <= 0 ? 1 : maxVolume;
    final step = plotRight / points.length;
    final bodyWidth = (step * 0.68).clamp(2.0, 14.0).toDouble();
    final paint = Paint();

    for (var i = 0; i < points.length; i++) {
      final point = points[i];
      final height = point.volume / safeMax * size.height;
      final x = (i + 0.5) * step;
      canvas.drawRect(
        Rect.fromLTWH(
          x - bodyWidth / 2,
          size.height - height,
          bodyWidth,
          height,
        ),
        paint..color = point.close >= point.open ? up : down,
      );
    }

    final painter = TextPainter(
      text: TextSpan(
        text: fmtWan(safeMax),
        style: TextStyle(fontSize: 10, color: axis),
      ),
      textDirection: TextDirection.ltr,
    )..layout(maxWidth: labelWidth);
    painter.paint(canvas, Offset(plotRight + 6, 0));
  }

  @override
  bool shouldRepaint(covariant _VolumePainter oldDelegate) {
    return oldDelegate.points != points ||
        oldDelegate.up != up ||
        oldDelegate.down != down;
  }
}
