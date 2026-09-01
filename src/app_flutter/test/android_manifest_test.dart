import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('release 主清单保留 INTERNET 权限', () {
    final manifest =
        File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
    expect(
      manifest,
      contains('<uses-permission android:name="android.permission.INTERNET"/>'),
    );
  });
}
