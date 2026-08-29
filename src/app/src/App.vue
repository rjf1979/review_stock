<script>
import { useStore } from '@/store'

export default {
  onLaunch() {
    useStore().bootstrap()
  },
  onShow() {},
  onHide() {}
}
</script>

<style>
/* 全局设计基线：红涨绿跌、纸白/深墨、强调红 */
page {
  --brand: #d23a2f;
  --up: #e0453a;
  --down: #0aa06b;
  --bg: #f5f4f0;
  --surface: #ffffff;
  --muted: #6b6a66;
  --line: #e4e1da;
  --ink: #1c1b18;
  --radius: 16rpx;
  --card-shadow: 0 8rpx 28rpx rgba(30, 28, 24, 0.06);
  background-color: var(--bg);
  color: var(--ink);
  font-size: 28rpx;
  line-height: 1.5;
}

view, text { box-sizing: border-box; }

/* 通用组件样式：卡片 / 渐变标题 / 涨跌 / 空态 */
.card {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--card-shadow);
  padding: 28rpx;
  margin: 20rpx 24rpx;
}
.section-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 18rpx;
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.section-title::before {
  content: '';
  width: 8rpx;
  height: 26rpx;
  border-radius: 4rpx;
  background: var(--brand);
}
.up { color: var(--up); }
.down { color: var(--down); }
.flat { color: var(--muted); }
.muted { color: var(--muted); }
.num { font-variant-numeric: tabular-nums; }

.empty {
  text-align: center;
  color: var(--muted);
  padding: 80rpx 24rpx;
  font-size: 26rpx;
}
.loading { text-align: center; color: var(--muted); padding: 80rpx 24rpx; }

.pill {
  display: inline-block;
  border-radius: 999rpx;
  padding: 4rpx 16rpx;
  font-size: 22rpx;
  line-height: 1.6;
  background: rgba(210, 58, 47, 0.1);
  color: var(--brand);
}
.pill--muted { background: rgba(107, 106, 102, 0.12); color: var(--muted); }

/* 免责声明 */
.disclaimer {
  color: var(--muted);
  font-size: 22rpx;
  text-align: center;
  padding: 28rpx 24rpx 60rpx;
}

@media (prefers-color-scheme: dark) {
  page {
    --bg: #14130f;
    --surface: #211f1a;
    --ink: #f0eee8;
    --muted: #9a968c;
    --line: #34312a;
    --card-shadow: 0 8rpx 28rpx rgba(0, 0, 0, 0.3);
  }
}
</style>
