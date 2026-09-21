import assert from 'node:assert/strict';

import { normalizeCommercialCode } from '../lib/gtin.ts';
import { hasValidGtinCheckDigit } from '../lib/scanner.ts';
import { SYSTEM_CATALOG_PRODUCTS } from '../lib/system-catalog.ts';
import { REGIONAL_CATALOG_CODES } from '../lib/system-catalog-regional.ts';
import { IPHONE_18_CATALOG_CODES } from '../lib/system-catalog-iphone18.ts';

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
  ['iPhone 18 Pro', 16],
  ['iPhone 18 Pro Max', 16],
]);

assert.equal(SYSTEM_CATALOG_PRODUCTS.length, 148);
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
  if (!product.model.startsWith('iPhone 18 ')) {
    assert.equal(
      product.codes.filter((code) =>
        ['Estados Unidos', 'Japão'].includes(code.market),
      ).length,
      product.model === 'iPhone 15' && product.memory !== '512 GB' ? 3 : 2,
      `Códigos de ${product.key}`,
    );
    const usa = product.codes[0];
    const japan = product.codes.find((code) => code.market === 'Japão')!;
    assert.equal(usa.market, 'Estados Unidos');
    assert.equal(japan.market, 'Japão');
    assert.match(usa.value, /^\d{12}$/);
    assert.match(japan.value, /^\d{13}$/);
  } else {
    assert.ok(
      ['Preto', 'Prateado', 'Glacial', 'Bordô'].includes(product.color),
    );
    assert.ok(['256 GB', '512 GB', '1 TB', '2 TB'].includes(product.memory));
    assert.ok(product.codes.some((code) => code.market === 'Japão'));
    for (const code of product.codes) {
      assert.ok(
        IPHONE_18_CATALOG_CODES.some(
          (evidence) =>
            evidence.model === product.model &&
            evidence.color === product.color &&
            evidence.memory === product.memory &&
            evidence.value === code.value &&
            evidence.sources.length > 0 &&
            evidence.sources.every((url) => new URL(url).protocol === 'https:'),
        ),
      );
    }
  }

  for (const code of product.codes) {
    assert.match(code.value, /^(?:\d{8}|\d{12,14})$/);
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
    assert.ok(code.market.length <= 60);
  }
  assert.ok(product.codes.length <= 20);
}

for (const [model, expected] of expectedByModel) {
  assert.equal(
    SYSTEM_CATALOG_PRODUCTS.filter((product) => product.model === model).length,
    expected,
    model,
  );
}
assert.equal(REGIONAL_CATALOG_CODES.length, 108);
for (const code of REGIONAL_CATALOG_CODES) {
  const product = SYSTEM_CATALOG_PRODUCTS.find(
    (product) =>
      product.model === code.model &&
      product.color === code.color &&
      product.memory === code.memory,
  );
  assert.ok(product, `Variante regional não encontrada: ${code.partNumber}`);
  assert.ok(product.codes.some((saved) => saved.value === code.value));
  assert.ok(code.partNumber.length > 0);
  assert.ok(code.sources.length > 0);
  for (const source of code.sources)
    assert.equal(new URL(source).protocol, 'https:');
}
assert.equal(IPHONE_18_CATALOG_CODES.length, 42);
assert.equal(normalizedCodes.size, 392);
// UPC, EAN with a leading zero, and GTIN-14 resolve to the same variation.
assert.equal(
  normalizeCommercialCode('195951414713'),
  normalizeCommercialCode('0195951414713'),
);
assert.equal(
  normalizeCommercialCode('195951414713'),
  normalizeCommercialCode('00195951414713'),
);

console.log(
  'System catalog checks passed: 148 variants and 392 unique GTINs (32 iPhone 18 variants, 42 new codes).',
);
