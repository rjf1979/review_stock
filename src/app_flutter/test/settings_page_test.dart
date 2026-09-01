import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hangqing_app/core/theme.dart';
import 'package:hangqing_app/features/settings/settings_page.dart';

void main() {
  testWidgets('实时刷新提供离散滑杆选择', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: buildLightTheme(),
          home: const Scaffold(body: SettingsPage()),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('刷新间隔'), findsOneWidget);
    expect(find.text('5 秒'), findsOneWidget);
    expect(find.text('60 秒'), findsNWidgets(2));
    expect(find.byType(Slider), findsOneWidget);
  });
}
