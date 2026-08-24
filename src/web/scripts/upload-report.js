// 手工上传分析报告：读本地 MD → 调 POST /api/upload/report
// 用法: UPLOAD_KEY=<后台“上传密钥”页面的密钥> node scripts/upload-report.js <md路径> <YYYY-MM-DD>
// 从 .env 读取 APP_URL / PORT
const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '..', '.env');
const env = {};
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
const UPLOAD_KEY = process.env.UPLOAD_KEY;
const BASE = process.env.APP_URL || env.APP_URL || `http://localhost:${process.env.PORT || env.PORT || 3000}`;

async function main() {
  const mdPath = process.argv[2];
  const date = process.argv[3];
  if (!mdPath || !date) { console.error('用法: UPLOAD_KEY=<密钥> node scripts/upload-report.js <md路径> <YYYY-MM-DD>'); process.exit(1); }
  const markdown = fs.readFileSync(mdPath, 'utf8');
  if (!UPLOAD_KEY) { console.error('请通过 UPLOAD_KEY 环境变量传入上传密钥（后台“上传密钥”页面获取）。'); process.exit(1); }
  const response = await fetch(`${BASE}/api/upload/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-upload-key': UPLOAD_KEY },
    body: JSON.stringify({ markdown, date })
  });
  const result = await response.json();
  console.log(response.status, JSON.stringify(result, null, 2));
  if (!response.ok) process.exit(1);
}
main().catch(error => { console.error(error.message); process.exit(1); });
