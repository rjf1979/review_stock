'use strict';
// 「先采集先共享」的仲裁编排。依赖注入 db/oss，便于无 PG/OSS 单测。

// 槽位认领（first-writer-wins）：谁先原子认领成功谁获胜并写 OSS，后来者读已有对象。
async function claimSlotAndWrite({ db, oss, slotKey, objectKey, deviceId, data }) {
  const won = await db.tryClaim(slotKey, deviceId);
  if (!won) {
    // url 由确定性 objectKey 直接派生，不依赖获胜方是否已写完（避免写入中的竞态）。
    const existing = await db.getSlot(slotKey);
    return {
      won: false,
      url: oss.url(objectKey),
      etag: existing && existing.object_key ? existing.etag : null,
      deviceId: existing ? existing.device_id : null,
      ready: Boolean(existing && existing.object_key), // 获胜方是否已落完对象
    };
  }
  const { url, etag } = await oss.putPublic(objectKey, JSON.stringify(data));
  await db.completeSlot(slotKey, objectKey, etag);
  return { won: true, url, etag, deviceId };
}

// 头指针更新（freshest-wins）：先写 OSS（幂等、键按时间桶），再单调更新头指针。
async function updateHeadAndWrite({ db, oss, stream, objectKey, updatedAt, deviceId, data }) {
  const { url, etag } = await oss.putPublic(objectKey, JSON.stringify(data));
  const accepted = await db.updateHead(stream, objectKey, updatedAt, deviceId);
  return { accepted, url, etag, deviceId, stale: !accepted };
}

module.exports = { claimSlotAndWrite, updateHeadAndWrite };
