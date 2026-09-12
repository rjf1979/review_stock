const assert = require('node:assert/strict');
const { SELECTION_CONTRACT_VERSION, createBatchId, normalizeSelectionRecord } = require('../selection-contract');

assert.equal(SELECTION_CONTRACT_VERSION, 3);
assert.match(createBatchId('selection', new Date('2026-09-11T01:02:03Z')), /^selection-20260911010203-[0-9a-f]{8}$/);
const legacy = normalizeSelectionRecord({ themeLeaderRanks: [{ code: 'BK1', rank: 1 }] });
assert.equal(legacy.selectionContractVersion, 1);
assert.deepEqual(legacy.candidateThemeRanks, [{ code: 'BK1', rank: 1 }]);
assert.deepEqual(legacy.boardLeaderRanks, []);
assert.equal(legacy.prescanBatchId, '');
assert.equal(legacy.quoteEvidence.status, 'missing');
console.log('selection-contract.test 通过');
