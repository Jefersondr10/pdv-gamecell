import assert from 'node:assert/strict';
import {
  SALE_ISSUES,
  SALE_CHECK_STATUSES,
} from '../lib/sale-display-status.ts';
import {
  parseSalesReportLink,
  salesReportPath,
  safeReportReturnTo,
} from '../lib/sales-report-link.ts';
const store = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const seller = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const path = salesReportPath(
  store,
  'complete',
  `period=day&day=2026-09-08&saleStatus=review&sellerId=${seller}&q=Lumora&alert=1&issue=missing_receipt&cursor=secret&csrf=secret`,
);
const parsed = parseSalesReportLink(path.slice(1));
assert.equal(parsed?.storeId, store);
assert.equal(parsed?.period, 'day');
assert.equal(parsed?.day, '2026-09-08');
assert.equal(parsed?.orderStatus, 'auto_review');
assert.equal(parsed?.seller, seller);
assert.equal(parsed?.query, 'Lumora');
assert.equal(parsed?.alertOnly, true);
assert.equal(parsed?.issue, 'missing_receipt');
assert.equal(parsed?.level, 'complete');
assert.equal(path.includes('secret'), false);
assert.equal(safeReportReturnTo(path), path);
for (const invalid of [
  'https://evil.test/' + path,
  '//evil.test' + path,
  '/\\evil.test',
  '/?report=sales&storeId=../secret',
  `${path}#external`,
  `${path}&saleStatus=unknown`,
  `${path}&orderStatus=none`,
  '/?report=sales&storeId=' + store + '&period=day&day=2026-02-30',
  '/?report=sales&storeId=' + store + '&period=month&month=2026-13',
]) {
  assert.equal(safeReportReturnTo(invalid), '/', invalid);
}
for (const level of ['simple', 'detailed', 'complete'] as const) {
  const restored = parseSalesReportLink(
    salesReportPath(store, level, 'period=all').slice(1),
  );
  assert.equal(restored?.level, level);
  assert.equal(restored?.period, 'all');
}
assert.equal(parseSalesReportLink('?period=all'), null);
for (const key of [
  ...SALE_CHECK_STATUSES.map((status) => status.key),
  'pending',
]) {
  const restored = parseSalesReportLink(
    salesReportPath(store, 'complete', `period=all&saleStatus=${key}`).slice(1),
  );
  assert.equal(restored?.orderStatus, `auto_${key}`);
}
for (const { key } of SALE_ISSUES) {
  const restored = parseSalesReportLink(
    salesReportPath(store, 'complete', `period=all&issue=${key}`).slice(1),
  );
  assert.equal(restored?.issue, key);
}
for (const scope of ['saved', 'display'] as const) {
  const restored = parseSalesReportLink(
    salesReportPath(
      store,
      'complete',
      `period=all&orderStatus=${seller}&statusScope=${scope}`,
    ).slice(1),
  );
  assert.equal(restored?.statusScope, scope);
  assert.equal(restored?.orderStatus, seller);
}
assert.equal(parsed?.statusScope, 'saved');
assert.equal(safeReportReturnTo(`${path}&statusScope=invalid`), '/');
assert.equal(
  safeReportReturnTo(`${path}&statusScope=saved&statusScope=display`),
  '/',
);
console.log(
  'Report links: exact filters/level/store, safe internal login return and rejected external destinations verified.',
);
