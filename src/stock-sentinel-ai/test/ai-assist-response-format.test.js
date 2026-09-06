const assert = require('node:assert/strict');
const http = require('node:http');

const aiAssist = require('../ai-assist');

(async () => {
  let requestBody = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ output_text: '{"verdict":"new_evidence","summary":"量价结构可继续观察。","changes":[],"evidence":[],"risks":[],"watchPoints":[]}' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const result = await aiAssist.chatCompletionsDetailed({
      baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'test-key', model: 'test-model', reasoningEffort: 'high', maxTokens: 512,
    }, [{ role: 'user', content: 'test' }]);
    assert.equal(result.content.includes('new_evidence'), true);
    assert.deepEqual(requestBody.response_format, { type: 'json_object' });
    assert.deepEqual(requestBody.messages, [{ role: 'user', content: 'test' }]);
    const sample = '{"verdict":"new_evidence","summary":"可观察。","changes":[],"evidence":[],"risks":[],"watchPoints":[]}';
    assert.deepEqual(aiAssist.extractJson(sample + sample), JSON.parse(sample), '兼容网关重复相同 JSON 时应仅恢复该唯一结果');
    assert.equal(aiAssist.extractJson(sample + '{"verdict":"insufficient"}'), null, '不同的重复对象不得被接受');
    assert.equal(aiAssist.chatEndpoint('https://api.deepseek.com'), 'https://api.deepseek.com/v1/chat/completions');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('ai assist structured response format contract passed');
})().catch((error) => { console.error(error); process.exit(1); });
