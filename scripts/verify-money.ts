import assert from 'node:assert/strict';

import { parseMoneyInput } from '../lib/money.ts';

const cases = new Map<string, number>([
  ['1234', 123_400],
  ['1234,56', 123_456],
  ['1.234,56', 123_456],
  ['1234.56', 123_456],
  ['1,234.56', 123_456],
  ['R$ 5.000,00', 500_000],
  ['0,01', 1],
  ['12,345', 1_234_500],
]);

for (const [input, expected] of cases) {
  assert.equal(parseMoneyInput(input), expected, input);
}
assert.equal(parseMoneyInput(''), 0);
assert.equal(parseMoneyInput('12,3456'), 0);

console.log('Money parser checks passed.');
