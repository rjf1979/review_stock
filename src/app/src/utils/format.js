// 红涨绿跌
export function pctClass(v) {
  const n = Number(v)
  if (v === null || v === undefined || Number.isNaN(n) || n === 0) return 'flat'
  return n > 0 ? 'up' : 'down'
}

export function pctText(v, digits = 2) {
  const n = Number(v)
  if (v === null || v === undefined || Number.isNaN(n)) return '--'
  return (n > 0 ? '+' : '') + n.toFixed(digits) + '%'
}

export function fmtNum(v, digits = 0) {
  const n = Number(v)
  if (v === null || v === undefined || Number.isNaN(n)) return '--'
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })
}

export function fmtWan(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '--'
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + '亿'
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(1) + '万'
  return String(n)
}

export function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function deepGet(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj)
}
