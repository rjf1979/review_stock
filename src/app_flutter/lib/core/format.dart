import 'package:flutter/material.dart';

import 'theme.dart';

// 红涨绿跌：颜色从当前主题的 AppPalette 取（对齐 PC 版两套皮肤）。
Color pctColor(BuildContext context, num? pct) {
  final pal = AppPalette.of(context);
  if (pct == null) return pal.flat;
  if (pct > 0) return pal.up;
  if (pct < 0) return pal.down;
  return pal.flat;
}

String pctText(num? pct, {int digits = 2}) {
  if (pct == null) return '--';
  final v = pct.toStringAsFixed(digits);
  return pct > 0 ? '+$v%' : '$v%';
}

String fmtNum(num? v, {int digits = 2}) {
  if (v == null) return '--';
  if (digits <= 0) return v.round().toString();
  return v.toStringAsFixed(digits);
}

/// 万/亿：大额成交额、资金流展示。
String fmtWan(num? v) {
  if (v == null) return '--';
  final abs = v.abs();
  if (abs >= 1e8) return '${(v / 1e8).toStringAsFixed(2)}亿';
  if (abs >= 1e4) return '${(v / 1e4).toStringAsFixed(2)}万';
  return v.toStringAsFixed(0);
}

/// 取一个时间值的 HH:mm。兼容完整 ISO（取时分秒段）、裸时间串。
String fmtTime(String? raw) {
  final s = (raw ?? '').trim();
  if (s.isEmpty) return '--';
  if (s.contains('T')) {
    final tail = s.split('T').last;
    return tail.length >= 5 ? tail.substring(0, 5) : s;
  }
  return s.length >= 5 ? s.substring(0, 5) : s;
}
