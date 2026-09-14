import assert from 'node:assert/strict';

import {
  parseSalesFilters,
  salesAggregateQueries,
} from '../lib/server/sales-filters.ts';

const storeId = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-09-05T12:00:00-03:00').getTime();
const sellerId = '22222222-2222-4222-8222-222222222222';
const sellerFilter = parseSalesFilters(
  new URL(`https://example.test/api/sales?period=today&sellerId=${sellerId}`),
  storeId,
  now,
);
assert.ok(sellerFilter.where.includes('s.seller_user_id = ?'));
assert.deepEqual(sellerFilter.bindings.slice(0, 2), [storeId, sellerId]);
assert.deepEqual(sellerFilter.comparison?.bindings.slice(0, 2), [
  storeId,
  sellerId,
]);
assert.throws(() =>
  parseSalesFilters(
    new URL('https://example.test/api/sales?sellerId=invalid'),
    storeId,
  ),
);

for (const status of ['reconciled', 'pending', 'cancelled']) {
  const parsed = parseSalesFilters(
    new URL(`https://example.test/api/sales?saleStatus=${status}`),
    storeId,
    now,
  );
  assert.equal(parsed.saleStatus, status);
  assert.ok(parsed.where.some((clause) => clause.includes("s.status = '")));
}
assert.throws(() =>
  parseSalesFilters(
    new URL('https://example.test/api/sales?saleStatus=invalid'),
    storeId,
    now,
  ),
);

for (const query of [
  'alert=1',
  'saleStatus=pending',
  'saleStatus=review',
  'issue=review',
  'issue=pending_payment',
  'alert=1&saleStatus=pending&issue=review',
]) {
  const parsed = parseSalesFilters(
    new URL(`https://example.test/api/sales?period=today&${query}`),
    storeId,
    now,
  );
  assert.ok(parsed.comparison, `${query}: previous period expected`);
  const statements = salesAggregateQueries(
    parsed.where.join(' AND '),
    parsed.bindings,
    {
      bindings: parsed.comparison!.bindings,
      filterSql: parsed.comparison!.where.join(' AND '),
    },
    parsed.alertOnly,
  );
  assert.equal(
    statements.length,
    2,
    `${query}: current and previous aggregates stay separate`,
  );
  for (const [index, statement] of statements.entries()) {
    assert.ok(
      Buffer.byteLength(statement.sql, 'utf8') < 100_000,
      `${query}: aggregate ${index + 1} exceeds the D1 statement limit`,
    );
  }
}

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
    [
      "p.method='cash'",
      "ar.kind='receipt'",
      'ar.receipt_amount_cents',
      '< s.products_total_cents',
    ].every((fragment) => clause.includes(fragment)),
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

for (const query of ['50', '00050', '#00050']) {
  const byDisplayedNumber = parseSalesFilters(
    new URL(
      `https://example.test/api/sales?period=all&q=${encodeURIComponent(query)}`,
    ),
    storeId,
    now,
  );
  assert.ok(
    byDisplayedNumber.where.some((clause) => clause.includes('s.number = ?')),
  );
  assert.equal(byDisplayedNumber.bindings[2], 50);
}

const directSale = parseSalesFilters(
  new URL(
    'https://example.test/api/sales?period=today&saleId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ),
  storeId,
  now,
);
assert.equal(directSale.comparison, null);

const customerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const customer = parseSalesFilters(
  new URL(
    `https://example.test/api/sales?period=today&customerId=${customerId}`,
  ),
  storeId,
  now,
);
assert.equal(customer.customerId, customerId);
assert.ok(customer.where.includes('s.customer_id = ?'));
assert.deepEqual(customer.bindings.slice(0, 2), [storeId, customerId]);
assert.ok(customer.comparison?.where.includes('s.customer_id = ?'));
assert.deepEqual(customer.comparison?.bindings.slice(0, 2), [
  storeId,
  customerId,
]);
assert.throws(() =>
  parseSalesFilters(
    new URL('https://example.test/api/sales?customerId=invalid'),
    storeId,
    now,
  ),
);

console.log('Sales filter and previous-period checks passed.');
