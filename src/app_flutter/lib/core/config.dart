/// 全局配置。
///
/// 云端行情 API 地址可通过 `--dart-define=MAPI_URL=...` 覆盖；
/// 默认指向生产域名 api.dailystock.askcode.cn。
class AppConfig {
  static const String apiBase = String.fromEnvironment(
    'MAPI_URL',
    defaultValue: 'https://api.dailystock.askcode.cn',
  );
}
