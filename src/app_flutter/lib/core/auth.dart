import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// 设备鉴权：首次启动注册设备，换取稳定 deviceId + 签名 token。
///
/// token 持久化在 secure storage；缺失/为空时用已保存的 deviceId 幂等重注册，
/// 保证同一设备长期复用同一身份（便于服务端 trust 标记）。
class DeviceAuth {
  DeviceAuth(this._dio, this._storage);

  final Dio _dio;
  final FlutterSecureStorage _storage;

  static const _kDeviceId = 'cloud_device_id';
  static const _kDeviceToken = 'cloud_device_token';

  Future<String?> get deviceId async => _storage.read(key: _kDeviceId);

  Future<String> ensureToken() async {
    final cached = await _storage.read(key: _kDeviceToken);
    if (cached != null && cached.isNotEmpty) return cached;

    final id = await _storage.read(key: _kDeviceId);
    final body = (id != null && id.isNotEmpty) ? {'deviceId': id} : <String, dynamic>{};
    final res = await _dio.post('/auth/device', data: body);
    final newId = res.data['deviceId'] as String;
    final token = res.data['token'] as String;
    await _storage.write(key: _kDeviceId, value: newId);
    await _storage.write(key: _kDeviceToken, value: token);
    return token;
  }
}
