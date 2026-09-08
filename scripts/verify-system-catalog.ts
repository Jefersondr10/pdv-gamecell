import assert from 'node:assert/strict';

import { normalizeCommercialCode } from '../lib/gtin.ts';
import { hasValidGtinCheckDigit } from '../lib/scanner.ts';
import { SYSTEM_CATALOG_PRODUCTS } from '../lib/system-catalog.ts';

const expectedByModel = new Map([
  ['iPhone 15', 15],
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

assert.equal(SYSTEM_CATALOG_PRODUCTS.length, 116);
assert.equal(
  SYSTEM_CATALOG_PRODUCTS.some(({ model }) =>
    /^iPhone 15 (Plus|Pro)/.test(model),
  ),
  false,
);
assert.deepEqual(
  [
    ...new Set(
      SYSTEM_CATALOG_PRODUCTS.filter(({ model }) => model === 'iPhone 15').map(
        ({ memory }) => memory,
      ),
    ),
  ],
  ['128 GB', '256 GB', '512 GB'],
);
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
  assert.equal(
    product.codes.length,
    product.model === 'iPhone 15' && product.memory !== '512 GB' ? 3 : 2,
    `Códigos de ${product.key}`,
  );
  const usa = product.codes[0];
  const japan = product.codes.at(-1)!;
  assert.equal(usa.market, 'Estados Unidos');
  assert.equal(japan.market, 'Japão');
  assert.match(usa.value, /^\d{12}$/);
  assert.match(japan.value, /^\d{13}$/);

  for (const code of product.codes) {
    assert.match(
      code.value,
      code.market === 'Estados Unidos' ? /^\d{12}$/ : /^\d{13}$/,
    );
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
assert.equal(normalizedCodes.size, 242);

console.log('System catalog checks passed: 116 variants and 242 unique GTINs.');
