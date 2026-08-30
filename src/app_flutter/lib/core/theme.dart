import 'package:flutter/material.dart';

/// 桌面版「股市脉搏」的两套主题色板（对齐 PC 前端 index.html 的 :root / body.dark）。
/// 红涨绿跌（A股口径）：light red #e34845 / green #168b72；dark red #ff8b83 / green #77d1b0。
class AppPalette extends ThemeExtension<AppPalette> {
  const AppPalette({
    required this.up,
    required this.down,
    required this.flat,
    required this.gold,
    required this.bg,
    required this.card,
    required this.paper,
    required this.ink,
    required this.muted,
    required this.line,
    required this.brand,
  });

  final Color up;    // 涨（红）
  final Color down;  // 跌（绿）
  final Color flat;  // 平（灰）
  final Color gold;
  final Color bg;
  final Color card;
  final Color paper;
  final Color ink;
  final Color muted;
  final Color line;
  final Color brand;

  static const light = AppPalette(
    up: Color(0xFFe34845),
    down: Color(0xFF168b72),
    flat: Color(0xFF697582),
    gold: Color(0xFFbc7a18),
    bg: Color(0xFFf6f8f7),
    card: Color(0xFFffffff),
    paper: Color(0xFFf6f8f7),
    ink: Color(0xFF17212b),
    muted: Color(0xFF697582),
    line: Color(0xFFdfe5e9),
    brand: Color(0xFFe34845),
  );

  static const dark = AppPalette(
    up: Color(0xFFff8b83),
    down: Color(0xFF77d1b0),
    flat: Color(0xFFa9b8c0),
    gold: Color(0xFFf0bd72),
    bg: Color(0xFF10171d),
    card: Color(0xFF1e2a33),
    paper: Color(0xFF17212b),
    ink: Color(0xFFedf2f3),
    muted: Color(0xFFa9b8c0),
    line: Color(0xFF344854),
    brand: Color(0xFFff8b83),
  );

  static AppPalette of(BuildContext context) =>
      Theme.of(context).extension<AppPalette>() ?? light;

  @override
  AppPalette copyWith({Color? up, Color? down, Color? flat, Color? gold, Color? bg, Color? card, Color? paper, Color? ink, Color? muted, Color? line, Color? brand}) {
    return AppPalette(
      up: up ?? this.up, down: down ?? this.down, flat: flat ?? this.flat, gold: gold ?? this.gold,
      bg: bg ?? this.bg, card: card ?? this.card, paper: paper ?? this.paper, ink: ink ?? this.ink,
      muted: muted ?? this.muted, line: line ?? this.line, brand: brand ?? this.brand,
    );
  }

  @override
  AppPalette lerp(ThemeExtension<AppPalette>? other, double t) {
    if (other is! AppPalette) return this;
    Color l(Color a, Color b) => Color.lerp(a, b, t)!;
    return AppPalette(
      up: l(up, other.up), down: l(down, other.down), flat: l(flat, other.flat), gold: l(gold, other.gold),
      bg: l(bg, other.bg), card: l(card, other.card), paper: l(paper, other.paper), ink: l(ink, other.ink),
      muted: l(muted, other.muted), line: l(line, other.line), brand: l(brand, other.brand),
    );
  }
}

ThemeData buildLightTheme() => _base(AppPalette.light, Brightness.light);
ThemeData buildDarkTheme() => _base(AppPalette.dark, Brightness.dark);

ThemeData _base(AppPalette p, Brightness brightness) {
  final scheme = ColorScheme.fromSeed(seedColor: p.brand, brightness: brightness).copyWith(
    surface: p.card,
    onSurface: p.ink,
    outline: p.line,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: p.bg,
    extensions: [p],
    appBarTheme: AppBarTheme(backgroundColor: p.card, foregroundColor: p.ink, elevation: 0),
    cardTheme: CardThemeData(color: p.card),
    dividerColor: p.line,
    textTheme: Typography.material2021().black.apply(bodyColor: p.ink, displayColor: p.ink),
  );
}
