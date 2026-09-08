import assert from 'node:assert/strict';
import { matchesProductSearch } from '../lib/product-search.ts';
import { normalizeClientName } from '../lib/client-name.ts';
const product = {
  model: 'iPhone 15',
  color: 'Preto',
  memory: '128 GB',
  codes: [{ code: '195950638011' }],
};
for (const query of [
  'iphone 15 128gb',
  '128 GB preto 15',
  'iphone15 preto',
  'PRETO iphone 15',
  '15 128 gb',
  '195950638011',
  '',
])
  assert.ok(matchesProductSearch(product, query), query);
for (const query of ['iphone 16', '15 256GB', 'iphone 15 azul'])
  assert.equal(matchesProductSearch(product, query), false, query);
assert.ok(
  matchesProductSearch(
    { ...product, color: 'Azul-névoa', memory: '1 TB' },
    '1tb nevoa iphone 15',
  ),
);
assert.equal(
  normalizeClientName('  CONÉCT   Atacado '),
  normalizeClientName('conect atacado'),
);
assert.notEqual(
  normalizeClientName('Conect A'),
  normalizeClientName('Conect B'),
);
console.log(
  'Product search: unordered model/color/memory, accents, memory spacing, codes and nonmatches passed.',
);
