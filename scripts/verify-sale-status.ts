import assert from 'node:assert/strict';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import {
  SYSTEM_SALE_STATUSES,
  saleDisplayStatus,
  saleIssues,
} from '../lib/sale-display-status.ts';
import { deriveReceiptReconciliation } from '../lib/receipt-reconciliation.ts';
import { parseSalesFilters } from '../lib/server/sales-filters.ts';
import { SALE_AUTO_STATUS_SQL } from '../lib/server/sale-status-sql.ts';

const db = new SqliteDatabase(':memory:');
db.database
  .exec(`CREATE TABLE sales (id TEXT, store_id TEXT, status TEXT, products_total_cents INTEGER, received_total_cents INTEGER, order_status_id TEXT, created_at INTEGER);
CREATE TABLE sale_items (id TEXT, sale_id TEXT, store_id TEXT, sold_price_cents INTEGER);
CREATE TABLE attachments (id TEXT, sale_id TEXT, store_id TEXT, sale_item_id TEXT, kind TEXT, receipt_amount_cents INTEGER);
CREATE TABLE receipt_ocr_jobs (attachment_id TEXT, status TEXT);`);
type Fixture = {
  status: 'completed' | 'cancelled';
  productsTotalCents: number;
  receivedTotalCents: number;
  items: { soldPriceCents: number; photos: unknown[] }[];
  receipts: { receiptAmountCents: number | null; receiptOcrStatus?: string }[];
};
const base = (): Fixture => ({
  status: 'completed',
  productsTotalCents: 10000,
  receivedTotalCents: 10000,
  items: [
    { soldPriceCents: 6000, photos: [{}] },
    { soldPriceCents: 4000, photos: [{}] },
  ],
  receipts: [{ receiptAmountCents: 6000 }, { receiptAmountCents: 4000 }],
});
const fixtures: { id: string; key: string; value: Fixture }[] = [];
function add(key: string, change: (value: Fixture) => void = () => {}) {
  const value = base();
  change(value);
  const id = `s${fixtures.length}`;
  fixtures.push({ id, key, value });
  const sale = {
    ...value,
    reconciliation: deriveReceiptReconciliation(
      value.receipts,
      value.productsTotalCents,
    ),
  };
  assert.equal(saleDisplayStatus(sale).key, key, `${id}: primary`);
  db.database
    .prepare('INSERT INTO sales VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(
      id,
      'a',
      value.status,
      value.productsTotalCents,
      value.receivedTotalCents,
      null,
      Date.now(),
    );
  value.items.forEach((item, i) => {
    const itemId = `${id}-i${i}`;
    db.database
      .prepare('INSERT INTO sale_items VALUES (?, ?, ?, ?)')
      .run(itemId, id, 'a', item.soldPriceCents);
    item.photos.forEach((_, p) =>
      db.database
        .prepare('INSERT INTO attachments VALUES (?, ?, ?, ?, ?, ?)')
        .run(`${itemId}-p${p}`, id, 'a', itemId, 'item_photo', null),
    );
    db.database
      .prepare('INSERT INTO attachments VALUES (?, ?, ?, ?, ?, ?)')
      .run(`${itemId}-foreign`, id, 'b', itemId, 'item_photo', null);
  });
  value.receipts.forEach((r, i) => {
    const rid = `${id}-r${i}`;
    db.database
      .prepare('INSERT INTO attachments VALUES (?, ?, ?, ?, ?, ?)')
      .run(rid, id, 'a', null, 'receipt', r.receiptAmountCents);
    if (r.receiptOcrStatus)
      db.database
        .prepare('INSERT INTO receipt_ocr_jobs VALUES (?, ?)')
        .run(rid, r.receiptOcrStatus);
  });
  db.database
    .prepare('INSERT INTO attachments VALUES (?, ?, ?, ?, ?, ?)')
    .run(`${id}-foreign`, id, 'b', null, 'receipt', 99999);
  const sql = db.database
    .prepare(`SELECT ${SALE_AUTO_STATUS_SQL} AS status FROM sales s WHERE id=?`)
    .get(id) as { status: string };
  assert.equal(sql.status, key, `${id}: SQL`);
  return sale;
}
add('reconciled');
add('cancelled', (v) => {
  v.status = 'cancelled';
  v.productsTotalCents = 0;
  v.items = [];
  v.receipts = [];
});
add('missing_price', (v) => {
  v.items[1].soldPriceCents = 0;
  v.productsTotalCents = 6000;
});
add('missing_receipt', (v) => {
  v.receipts = [];
});
add('review', (v) => {
  v.receipts[1].receiptAmountCents = 3999;
});
for (const status of ['pending', 'processing', 'retry'])
  add('reading', (v) => {
    v.receipts[1] = { receiptAmountCents: null, receiptOcrStatus: status };
  });
for (const status of ['needs_review', 'done', 'cancelled', undefined])
  add('review', (v) => {
    v.receipts[1] = { receiptAmountCents: null, receiptOcrStatus: status };
  });
add('reconciled', (v) => {
  v.receipts[1].receiptOcrStatus = 'cancelled';
});
add('pending_payment', (v) => {
  v.receivedTotalCents = 9999;
});
add('overpaid', (v) => {
  v.receivedTotalCents = 10001;
});
add('missing_photo', (v) => {
  v.items[1].photos = [];
});
add('review', (v) => {
  v.receipts[0].receiptAmountCents = 0;
  v.receipts[1].receiptAmountCents = 10000;
});
const multiple = add('missing_price', (v) => {
  v.items[0].soldPriceCents = 0;
  v.productsTotalCents = 4000;
  v.receipts = [];
  v.receivedTotalCents = 0;
  v.items[1].photos = [];
});
assert.deepEqual(
  saleIssues(multiple).map((s) => s.key),
  ['missing_price', 'missing_receipt', 'pending_payment', 'missing_photo'],
);
for (const key of [
  ...SYSTEM_SALE_STATUSES.map((s) => s.key),
  'pending',
  'alert',
]) {
  const parsed = parseSalesFilters(
    new URL(
      `https://example.test/api/sales?period=all&${key === 'alert' ? 'alert=1' : `saleStatus=${key}`}`,
    ),
    'a',
  );
  const result = db.database
    .prepare(
      `SELECT s.id FROM sales s WHERE ${parsed.where.join(' AND ')} ORDER BY s.id`,
    )
    .all(...parsed.bindings) as { id: string }[];
  const expected = fixtures
    .filter((f) =>
      ['pending', 'alert'].includes(key)
        ? !['cancelled', 'reconciled'].includes(f.key)
        : f.key === key,
    )
    .map((f) => f.id)
    .sort();
  assert.deepEqual(
    result.map((r) => r.id),
    expected,
    `filter ${key}`,
  );
}
// Repricing recalculates proof/payment comparisons without modifying either.
const repriced = base();
repriced.productsTotalCents = 11000;
repriced.items[1].soldPriceCents = 5000;
assert.deepEqual(
  saleIssues({
    ...repriced,
    reconciliation: deriveReceiptReconciliation(repriced.receipts, 11000),
  }).map((s) => s.key),
  ['review', 'pending_payment'],
);
repriced.productsTotalCents = 10000;
repriced.items[1].soldPriceCents = 4000;
assert.equal(
  saleDisplayStatus({
    ...repriced,
    reconciliation: deriveReceiptReconciliation(repriced.receipts, 10000),
  }).key,
  'reconciled',
);
db.close();
console.log(
  'Automatic statuses: TS/SQL parity, filter aliases, every missing field, concurrent issues, repricing and tenant boundaries passed.',
);
