import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productEditorPayload } from '../lib/product-editor.ts';
import { changedProductPrices, priceInput } from '../lib/product-prices.ts';

const values = {
  model: 'iPhone 17',
  color: 'Preto',
  memory: '256 GB',
  price: '4.950,00',
};
assert.deepEqual(productEditorPayload(values, '  4006381333931 ', 'Brasil'), {
  model: values.model,
  color: values.color,
  memory: values.memory,
  defaultPriceCents: 495000,
  addCode: { code: '4006381333931', market: 'Brasil' },
});
assert.equal('addCode' in productEditorPayload(values, ' ', ''), false);
assert.equal(priceInput(495000), '4.950,00');
assert.deepEqual(
  changedProductPrices({ a: 495000, b: 500000 }, { a: '4950', b: '5.100,50' }),
  [{ productId: 'b', expectedPriceCents: 500000, defaultPriceCents: 510050 }],
);
assert.deepEqual(changedProductPrices({ a: 1 }, { a: '0' }), [
  { productId: 'a', expectedPriceCents: 1, defaultPriceCents: 0 },
]);
for (const invalid of ['', ' ', '-100', 'abc', '1,,00', '1,001', '10000001'])
  assert.throws(
    () => changedProductPrices({ a: 0 }, { a: invalid }),
    Error,
    invalid,
  );
const css = readFileSync('app/globals.css', 'utf8');
assert.match(css, /-webkit-user-select: none/);
assert.match(
  css,
  /textarea,[\s\S]*?\[data-copyable\],[\s\S]*?user-select: text/,
);
console.log(
  'Product save includes pending code; prices parse exactly; identifiers and inputs remain selectable.',
);
