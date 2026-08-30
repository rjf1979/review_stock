import 'package:dio/dio.dart';

import 'auth.dart';

/// 云端行情 API 客户端。
///
/// 读接口公开无鉴权；写接口（/collect/*）由 [DeviceAuth] 懒注册设备后带 Bearer。
class ApiClient {
  ApiClient(this._dio, this._auth);

  final Dio _dio;
  final DeviceAuth _auth;

  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async {
    final res = await _dio.get<Map<String, dynamic>>(path, queryParameters: query);
    return (res.data ?? const <String, dynamic>{});
  }

  Future<Map<String, dynamic>> upload(String path, {Object? data}) async {
    final token = await _auth.ensureToken();
    final res = await _dio.post<Map<String, dynamic>>(
      path,
      data: data,
      options: Options(headers: {'Authorization': 'Bearer $token'}),
    );
    return (res.data ?? const <String, dynamic>{});
  }
}
