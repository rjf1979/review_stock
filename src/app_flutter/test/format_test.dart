import 'package:flutter_test/flutter_test.dart';
import 'package:hangqing_app/core/format.dart';
import 'package:hangqing_app/core/theme.dart';

void main() {
  group('主题色板（对齐 PC 版）', () {
    test('light 红涨绿跌', () {
      expect(AppPalette.light.up.toARGB32(), 0xFFe34845);
      expect(AppPalette.light.down.toARGB32(), 0xFF168b72);
    });
    test('dark 红涨绿跌', () {
      expect(AppPalette.dark.up.toARGB32(), 0xFFff8b83);
      expect(AppPalette.dark.down.toARGB32(), 0xFF77d1b0);
    });
  });

  group('涨跌幅格式化', () {
    test('正数带加号', () {
      expect(pctText(2.5), '+2.50%');
    });
    test('负数带减号', () {
      expect(pctText(-1.2), '-1.20%');
    });
    test('缺失', () {
      expect(pctText(null), '--');
    });
  });

  group('金额格式化', () {
    test('亿', () {
      expect(fmtWan(1.5e9), '15.00亿');
    });
    test('万', () {
      expect(fmtWan(2.3e5), '23.00万');
    });
  });
}
