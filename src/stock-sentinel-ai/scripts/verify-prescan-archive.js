const { verifyPrescanArchive } = require('../market-prescan-integrity');

const input = process.argv[2];
if (!input) {
  console.error('用法：npm run verify:prescan-archive -- <批次ID或主归档路径>');
  process.exit(1);
}

verifyPrescanArchive(input).then((result) => {
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'complete') process.exitCode = 2;
}).catch((error) => {
  console.error(error && error.message || error);
  process.exitCode = 1;
});
