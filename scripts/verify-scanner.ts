import assert from 'node:assert/strict';

import {
  expandUpce,
  hasValidGtinCheckDigit,
  normalizeCandidate,
} from '../lib/scanner.ts';

assert.equal(hasValidGtinCheckDigit('4006381333931'), true);
assert.equal(hasValidGtinCheckDigit('4006381333932'), false);
assert.equal(expandUpce('04252614'), '042100005264');

assert.equal(
  normalizeCandidate('4006381333931', 'ean_13', 'product')?.normalizedValue,
  '04006381333931',
);
assert.equal(
  normalizeCandidate('96385074', 'ean_8', 'product')?.normalizedValue,
  '00000096385074',
);
assert.equal(
  normalizeCandidate('036000291452', 'upc_a', 'product')?.key,
  'PRODUCT:00036000291452',
);
assert.equal(
  normalizeCandidate('0036000291452', 'ean_13', 'product')?.key,
  'PRODUCT:00036000291452',
);
assert.equal(
  normalizeCandidate('04252614', 'upc_e', 'product')?.normalizedValue,
  '00042100005264',
);
assert.equal(normalizeCandidate('4006381333932', 'ean_13', 'product'), null);

const serial = normalizeCandidate('SHC9P06R095', 'code_128', 'apple_serial');
assert.equal(serial?.rawValue, 'SHC9P06R095');
assert.equal(serial?.normalizedValue, 'HC9P06R095');
assert.equal(serial?.prefixStripped, true);
assert.equal(serial?.key, 'SERIAL:HC9P06R095');
assert.equal(
  normalizeCandidate('HC9P06R095', 'code_128', 'apple_serial')?.normalizedValue,
  'HC9P06R095',
);
assert.equal(normalizeCandidate('SN inválido!', 'code_128', 'apple_serial'), null);

console.log('Scanner normalization checks passed.');
