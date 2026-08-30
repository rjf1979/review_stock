'use strict';
// OSS 封装：写 public-read 对象 + 生成 CDN URL。AK/SK 只在本服务端，绝不下发客户端。

function createOss(cfg) {
  let OSS;
  try { OSS = require('ali-oss'); } catch { throw new Error('缺少依赖 ali-oss，请先 npm install'); }
  const client = new OSS({
    region: cfg.region,
    accessKeyId: cfg.accessKeyId,
    accessKeySecret: cfg.accessKeySecret,
    bucket: cfg.bucket,
    secure: true,
  });
  const cdn = String(cfg.cdnDomain || '').replace(/\/+$/, '');
  const endpoint = cfg.endpoint || `oss-${cfg.region}.aliyuncs.com`;
  function url(key) {
    if (cdn) return `https://${cdn}/${key}`;
    return `https://${cfg.bucket}.${endpoint}/${key}`;
  }
  async function putPublic(key, body) {
    const res = await client.put(key, body, { headers: { 'x-oss-object-acl': 'public-read' } });
    const etag = (res && res.res && res.res.headers && res.res.headers.etag) || (res && res.etag) || null;
    return { url: url(key), etag: typeof etag === 'string' ? etag.replace(/^"|"$/g, '') : etag };
  }
  async function getObject(key) {
    const res = await client.get(key);
    return res.content.toString('utf8');
  }
  return { putPublic, getObject, url };
}

module.exports = { createOss };
