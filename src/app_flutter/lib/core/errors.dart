import 'package:dio/dio.dart';

String friendlyErrorMessage(Object error) {
  if (error is DioException) {
    final statusCode = error.response?.statusCode;
    switch (statusCode) {
      case 400:
        return '请求参数有误，请稍后重试';
      case 401:
        return '设备身份验证失败，请重新打开应用';
      case 403:
        return '暂无访问权限';
      case 404:
        return '暂无数据';
      case 429:
        return '请求太频繁，请稍后重试';
    }
    if (statusCode != null && statusCode >= 500) {
      return '云端服务暂时不可用，请稍后重试';
    }
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return '网络响应超时，请稍后重试';
      case DioExceptionType.badCertificate:
        return '网络证书校验失败，请检查网络环境';
      case DioExceptionType.cancel:
        return '请求已取消';
      case DioExceptionType.badResponse:
        return '云端返回异常，请稍后重试';
      case DioExceptionType.connectionError:
        return '网络连接失败，请检查网络后重试';
      case DioExceptionType.unknown:
        break;
      default:
        return '网络请求失败，请稍后重试';
    }
  }
  if (error is TypeError || error is FormatException) {
    return '数据格式暂不兼容，请更新应用后重试';
  }
  return '加载失败，请检查网络后重试';
}
