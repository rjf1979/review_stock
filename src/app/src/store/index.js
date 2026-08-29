import { reactive } from 'vue'

// 跨页面共享的轻量响应式状态（最新快照 / 自选 / 服务状态）
export function createStore() {
  const state = reactive({
    realtime: null,
    reviewCache: {},
    watchlist: [],
    status: null,
    updatedAt: null
  })

  function bootstrap() {
    try {
      const list = uni.getStorageSync('watchlist')
      if (Array.isArray(list)) state.watchlist = list
    } catch (e) {
      /* ignore */
    }
  }

  function setRealtime(payload) {
    state.realtime = payload
    state.updatedAt = payload?.updatedAt || null
    // 存一份轻量快照供启动预加载
    uni.setStorageSync('last_realtime', payload)
  }

  function setStatus(payload) {
    state.status = payload
  }

  function setWatchlist(list) {
    state.watchlist = Array.isArray(list) ? list.slice(0, 50) : []
    uni.setStorageSync('watchlist', state.watchlist)
  }

  function cacheReview(date, payload) {
    if (date && payload) state.reviewCache[date] = payload
  }

  return { state, bootstrap, setRealtime, setStatus, setWatchlist, cacheReview }
}

let store = null

export function useStore() {
  if (!store) store = createStore()
  return store
}
