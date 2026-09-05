import assert from 'node:assert/strict';

import { parseSalesFilters } from '../lib/server/sales-filters.ts';

const storeId = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-09-05T12:00:00-03:00').getTime();

const today = parseSalesFilters(
  new URL('https://example.test/api/sales?period=today&issue=pending_payment'),
  storeId,
  now,
);
assert.equal(today.from, new Date('2026-09-05T00:00:00-03:00').getTime());
assert.equal(today.to, new Date('2026-09-06T00:00:00-03:00').getTime());
assert.equal(today.comparison?.label, 'ontem');
assert.deepEqual(today.comparison?.bindings.slice(0, 3), [
  storeId,
  new Date('2026-09-04T00:00:00-03:00').getTime(),
  new Date('2026-09-05T00:00:00-03:00').getTime(),
]);
assert.ok(
  today.comparison?.where.some((clause) =>
    clause.includes('received_total_cents < s.products_total_cents'),
  ),
);

const month = parseSalesFilters(
  new URL('https://example.test/api/sales?period=month&month=2026-03'),
  storeId,
  now,
);
assert.equal(month.comparison?.label, 'mês anterior');
assert.deepEqual(month.comparison?.bindings.slice(0, 3), [
  storeId,
  new Date('2026-02-01T00:00:00-03:00').getTime(),
  new Date('2026-03-01T00:00:00-03:00').getTime(),
]);

const all = parseSalesFilters(
  new URL('https://example.test/api/sales?period=all'),
  storeId,
  now,
);
assert.equal(all.comparison, null);

const directSale = parseSalesFilters(
  new URL(
    'https://example.test/api/sales?period=today&saleId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ),
  storeId,
  now,
);
assert.equal(directSale.comparison, null);

console.log('Sales filter and previous-period checks passed.');
