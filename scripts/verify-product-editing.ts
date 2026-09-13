import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productEditorPayload } from '../lib/product-editor.ts';
import {
  changedProductPrices,
  parseProductPriceInput,
  priceInput,
} from '../lib/product-prices.ts';
import { clientEditorPayload } from '../lib/client-editor.ts';

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
const original = {
  model: values.model,
  color: values.color,
  memory: values.memory,
  defaultPriceCents: 495000,
};
assert.deepEqual(
  productEditorPayload({ ...values, color: 'Azul' }, '', '', original),
  {
    color: 'Azul',
    expected: { color: 'Preto' },
  },
);
assert.deepEqual(productEditorPayload(values, '', '', original), {});
assert.deepEqual(
  productEditorPayload({ ...values, price: '5.000,00' }, '', '', original),
  {
    defaultPriceCents: 500000,
    expected: { defaultPriceCents: 495000 },
  },
);
assert.deepEqual(
  clientEditorPayload(
    { name: 'Cliente', phone: '999', email: '', notes: '' },
    {
      name: 'Cliente',
      phone: '111',
      email: null,
      notes: null,
    },
  ),
  { phone: '999', expected: { phone: '111' } },
);
assert.equal(parseProductPriceInput('', true), 0);
assert.equal(parseProductPriceInput('R$ 4.950,00'), 495000);
assert.equal(parseProductPriceInput('RS 0,01'), 1);
for (const invalid of [
  'abc',
  '-4.500,00',
  '+4500',
  '4.500,000',
  '1e3',
  '99999999999999999999999999',
]) {
  assert.throws(() => parseProductPriceInput(invalid, true), Error, invalid);
  assert.throws(
    () => productEditorPayload({ ...values, price: invalid }, '', ''),
    Error,
    invalid,
  );
}
assert.throws(() =>
  productEditorPayload({ ...values, price: '' }, '', '', original),
);
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
