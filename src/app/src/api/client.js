import { getApiBase } from './config'

/**
 * 统一请求封装：自动拼接 API 基址，统一超时/错误。
 * 云端返回 { status: 'stale', ... } 时不做异常处理，交给页面降级展示。
 */
export function request(path, { method = 'GET', data, timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: getApiBase() + path,
      method,
      data,
      timeout,
      header: { 'Content-Type': 'application/json' },
      success(res) {
        const { statusCode, data: body } = res
        if (statusCode >= 200 && statusCode < 300) return resolve(body || {})
        reject(new Error((body && (body.error || body.message)) || `请求失败（${statusCode}）`))
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || '网络请求失败，请检查 API 地址'))
      }
    })
  })
}
