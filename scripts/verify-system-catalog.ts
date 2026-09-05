import assert from 'node:assert/strict';

import { normalizeCommercialCode } from '../lib/gtin.ts';
import { hasValidGtinCheckDigit } from '../lib/scanner.ts';
import { SYSTEM_CATALOG_PRODUCTS } from '../lib/system-catalog.ts';

const expectedByModel = new Map([
  ['iPhone 16', 15],
  ['iPhone 16 Plus', 15],
  ['iPhone 16 Pro', 16],
  ['iPhone 16e', 6],
  ['iPhone 17', 10],
  ['iPhone Air', 12],
  ['iPhone 17 Pro', 9],
  ['iPhone 17 Pro Max', 12],
  ['iPhone 17e', 6],
]);

assert.equal(SYSTEM_CATALOG_PRODUCTS.length, 101);
assert.equal(
  SYSTEM_CATALOG_PRODUCTS.some(({ model }) => model === 'iPhone 16 Pro Max'),
  false,
);

const productKeys = new Set<string>();
const normalizedCodes = new Set<string>();
for (const product of SYSTEM_CATALOG_PRODUCTS) {
  assert.equal(
    productKeys.has(product.key),
    false,
    `Produto repetido: ${product.key}`,
  );
  productKeys.add(product.key);
  assert.equal(product.codes.length, 2, `Códigos de ${product.key}`);
  const [usa, japan] = product.codes;
  assert.equal(usa.market, 'Estados Unidos');
  assert.equal(japan.market, 'Japão');
  assert.match(usa.value, /^\d{12}$/);
  assert.match(japan.value, /^\d{13}$/);

  for (const code of product.codes) {
    assert.equal(
      hasValidGtinCheckDigit(code.value),
      true,
      `Dígito verificador inválido: ${code.value}`,
    );
    const normalized = normalizeCommercialCode(code.value);
    assert.equal(
      normalizedCodes.has(normalized),
      false,
      `Código repetido: ${code.value}`,
    );
    normalizedCodes.add(normalized);
  }
}

for (const [model, expected] of expectedByModel) {
  assert.equal(
    SYSTEM_CATALOG_PRODUCTS.filter((product) => product.model === model).length,
    expected,
    model,
  );
}
assert.equal(normalizedCodes.size, 202);

console.log('System catalog checks passed: 101 variants and 202 unique GTINs.');
