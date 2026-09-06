// 智诊盯盘 · 预加载：向渲染进程暴露最小化白名单桥接，当前无需 Node 能力。
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('volumeInsight', {
  version: '0.1.0',
  platform: process.platform,
});
