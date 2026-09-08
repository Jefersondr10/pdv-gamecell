import assert from 'node:assert/strict';
import { productColorValue } from '../lib/product-color.ts';
import { stockColorEmoji } from '../lib/stock-whatsapp.ts';
import { SYSTEM_CATALOG_PRODUCTS } from '../lib/system-catalog.ts';

for (const [pt, en] of [
  ['Rosa', 'Pink'],
  ['Lavanda', 'Lavender'],
  ['Prateado', 'Silver'],
  ['Verde-azulado', 'Teal'],
  ['Azul-intenso', 'Deep blue'],
  ['Verde-acinzentado', 'Teal'],
  ['Verde‑acinzentado', 'Teal'],
  ['Azul-névoa', 'Mist blue'],
  ['Rosa-pálido', 'Soft pink'],
  ['Dourado-claro', 'Light gold'],
  ['Titânio-deserto', 'Desert titanium'],
])
  assert.equal(productColorValue(pt), productColorValue(en), `${pt} / ${en}`);
assert.equal(productColorValue('Rosa', 'iPhone 16'), '#ed9bcc');
assert.equal(productColorValue('Pink', 'iPhone 16 Plus'), '#ed9bcc');
assert.notEqual(
  productColorValue('Rosa', 'iPhone 15'),
  productColorValue('Rosa', 'iPhone 16'),
);
assert.equal(
  productColorValue('Rosa', 'iPhone 15'),
  productColorValue('Pink', 'iPhone 15 Plus'),
);
assert.notEqual(productColorValue('Rosa'), productColorValue('Vermelho'));
assert.notEqual(productColorValue('Verde-azulado'), productColorValue('Azul'));
assert.notEqual(productColorValue('Azul-intenso'), productColorValue('Azul'));
assert.notEqual(productColorValue('Lavanda'), productColorValue('Azul'));
assert.equal(productColorValue('Sem cor'), '#cbd0d6');
assert.equal(productColorValue('Acabamento desconhecido'), '#cbd0d6');
for (const product of SYSTEM_CATALOG_PRODUCTS) {
  assert.notEqual(
    productColorValue(product.color, product.model),
    '#cbd0d6',
    product.key,
  );
  assert.notEqual(stockColorEmoji(product.color), '▫️', product.key);
}
assert.equal(stockColorEmoji('Verde-azulado'), '🟢');
assert.equal(stockColorEmoji('Prateado'), '🩶');
console.log(
  'Product color checks passed: catalog finishes, aliases, pink/red separation and WhatsApp.',
);
