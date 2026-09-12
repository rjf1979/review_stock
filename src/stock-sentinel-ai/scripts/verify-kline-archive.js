// 只读校验 K 线版本不可变归档（第十五阶段 D15-02）。
// 用法：npm run verify:kline-archive -- <归档ID或主归档路径>
// 只读：不修复、不覆盖、不回写归档；退出码 0=complete，2=incomplete，3=corrupt，1=执行失败。
const { verifyKlineVersionArchive } = require('../kline-archive');
const { readWatchRecommendationBatches } = require('../storage');

const input = process.argv[2];
if (!input) {
  console.error('用法：npm run verify:kline-archive -- <归档ID或主归档路径>');
  process.exit(1);
}

verifyKlineVersionArchive(input, {
  reviewBatchReader: async (batchId) => {
    const rows = await readWatchRecommendationBatches({ batchId, limit: 1 });
    return rows.length > 0;
  },
}).then((result) => {
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'complete') return;
  process.exitCode = result.status === 'corrupt' ? 3 : 2;
}).catch((error) => {
  console.error(error && error.message || error);
  process.exitCode = 1;
});
