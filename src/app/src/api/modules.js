import { request } from './client'

export const getRealtime = () => request('/api/realtime')

export const getReview = (date) =>
  request('/api/review' + (date ? '?date=' + encodeURIComponent(date) : ''))

export const getReviews = () => request('/api/reviews')

export const getDragon = (date) =>
  request('/api/dragon' + (date ? '?date=' + encodeURIComponent(date) : ''))

export const getStocks = (codes) =>
  request('/api/stocks?codes=' + encodeURIComponent(codes))

export const getKline = (code, date) =>
  request('/api/kline?code=' + encodeURIComponent(code) + (date ? '&date=' + encodeURIComponent(date) : ''))

export const getStatus = () => request('/api/status')
