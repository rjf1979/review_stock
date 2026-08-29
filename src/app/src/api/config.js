export const DEFAULT_API_BASE = 'https://mapi.zhicha.io'

export function getApiBase() {
  try {
    const stored = uni.getStorageSync('api_base')
    return stored || DEFAULT_API_BASE
  } catch (e) {
    return DEFAULT_API_BASE
  }
}

export function setApiBase(url) {
  uni.setStorageSync('api_base', String(url || '').trim())
}
