const assert = require('assert');
const { pankouEventVisible, PANKOU_ORDER_MIN_AMOUNT_YI } = require('./review-core');

const order = { key: 'largeBuy', label: '大笔买入', format: 'order' };
const change = { key: 'rapidRise', label: '急速拉升', format: 'change' };

// 大笔买卖：仅保留单笔成交额 ≥ 1000 万元
assert.strictEqual(PANKOU_ORDER_MIN_AMOUNT_YI, 0.1);
assert.strictEqual(pankouEventVisible(order, { code: '600519', name: '贵州茅台', time: '10:30:00', amountYi: 0.1 }), true);
assert.strictEqual(pankouEventVisible(order, { code: '600519', name: '贵州茅台', time: '10:30:00', amountYi: 1.2 }), true);
assert.strictEqual(pankouEventVisible(order, { code: '600519', name: '贵州茅台', time: '10:30:00', amountYi: 0.099 }), false);
assert.strictEqual(pankouEventVisible(order, { code: '600519', name: '贵州茅台', time: '10:30:00', amountYi: null }), false);
assert.strictEqual(pankouEventVisible(order, { code: '600519', name: '贵州茅台', time: null, amountYi: 1.2 }), false);

// 非买卖类不受金额门槛约束，但缺关键字段仍过滤
assert.strictEqual(pankouEventVisible(change, { code: '300750', name: '宁德时代', time: '10:31:00', changePct: 3.2 }), true);
assert.strictEqual(pankouEventVisible(change, { code: '300750', name: '宁德时代', time: null, changePct: 3.2 }), false);
assert.strictEqual(pankouEventVisible(change, { code: '', name: '宁德时代', time: '10:31:00', changePct: 3.2 }), false);

console.log('pankou filter tests passed');
