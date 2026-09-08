import assert from 'node:assert/strict';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import { readOverview } from '../lib/server/overview.ts';
import { overviewComparison } from '../lib/overview.ts';

const db = new SqliteDatabase(':memory:');
db.database.exec(`
  CREATE TABLE sales (id TEXT PRIMARY KEY, store_id TEXT, number INTEGER, customer_name TEXT, created_at INTEGER, status TEXT, received_total_cents INTEGER);
  CREATE TABLE attachments (id TEXT PRIMARY KEY, store_id TEXT, sale_id TEXT, kind TEXT, file_name TEXT, mime_type TEXT, size_bytes INTEGER, receipt_amount_cents INTEGER, receipt_amount_source TEXT, receipt_amount_confirmed_at INTEGER, created_at INTEGER);
  CREATE TABLE payments (id TEXT, store_id TEXT, sale_id TEXT, method TEXT, amount_cents INTEGER);
  CREATE TABLE receipt_ocr_jobs (attachment_id TEXT PRIMARY KEY, status TEXT);
  CREATE TABLE sale_items (id TEXT, sale_id TEXT);
`);
const midnight = Date.parse('2026-09-05T00:00:00-03:00');
const sale = (
  id: string,
  paid: number,
  store = 'a',
  time = midnight,
  status = 'completed',
) =>
  db.database
    .prepare('INSERT INTO sales VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, store, 1, `Cliente ${id}`, time, status, paid);
const receipt = (
  id: string,
  saleId: string,
  amount: number | null,
  store = 'a',
  source = 'ocr',
  kind = 'receipt',
) =>
  db.database
    .prepare('INSERT INTO attachments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      id,
      store,
      saleId,
      kind,
      `${id}.pdf`,
      'application/pdf',
      100,
      amount,
      amount === null ? null : source,
      amount === null ? null : midnight,
      midnight + 5 * 86400000,
    );
const payment = (
  id: string,
  saleId: string,
  amount: number,
  method = 'pix',
  store = 'a',
) =>
  db.database
    .prepare('INSERT INTO payments VALUES (?, ?, ?, ?, ?)')
    .run(id, store, saleId, method, amount);
const read = (store = 'a', extra = '') =>
  readOverview(
    db as unknown as D1Database,
    new URL(`https://test/api/overview?period=day&day=2026-09-05&${extra}`),
    store,
  );
try {
  sale('one', 10000);
  payment('pay1', 'one', 6000);
  payment('pay2', 'one', 4000, 'cash');
  receipt('r1', 'one', 6000);
  receipt('r2', 'one', 4000, 'a', 'manual');
  db.database.exec(
    "INSERT INTO receipt_ocr_jobs VALUES ('r2', 'cancelled'); INSERT INTO sale_items VALUES ('i1', 'one'), ('i2', 'one');",
  );
  receipt('photo', 'one', 999999, 'a', 'ocr', 'item_photo');
  // Defensively tenant-filter attachments and payments even for bad foreign rows.
  receipt('foreign-file', 'one', 999999, 'b');
  payment('foreign-pay', 'one', 999999, 'cash', 'b');
  let page = await read();
  assert.deepEqual(page.totals, {
    saleCount: 1,
    receivedCents: 10000,
    cashCents: 4000,
    receiptCents: 10000,
    receiptCount: 2,
    pendingCount: 0,
    missingCount: 0,
    divergentCount: 0,
  });
  assert.equal(overviewComparison(page.totals), 'matched');
  assert.equal(page.items[0].receipts.length, 2);
  assert.equal(page.items[0].receipts[1].receiptAmountSource, 'manual');
  assert.equal(page.items[0].receipts[1].processingStatus, 'cancelled');
  assert.equal(page.items[0].receipts[0].url, '/api/files/r1');

  sale('under', 1000, 'offset');
  receipt('under-r', 'under', 900, 'offset');
  sale('over', 1000, 'offset');
  receipt('over-r', 'over', 1100, 'offset');
  page = await read('offset');
  assert.equal(page.totals.receivedCents, page.totals.receiptCents);
  assert.equal(page.totals.divergentCount, 2);
  assert.equal(overviewComparison(page.totals), 'review');

  receipt('pending', 'one', null);
  db.database.exec(
    "INSERT INTO receipt_ocr_jobs VALUES ('pending', 'needs_review');",
  );
  page = await read();
  assert.equal(page.totals.pendingCount, 1);
  assert.equal(page.totals.divergentCount, 0);
  assert.equal(page.totals.receiptCents, 10000);
  assert.equal(overviewComparison(page.totals), 'pending');
  sale('missing', 0);
  assert.equal((await read()).totals.missingCount, 1);
  sale('cancelled', 900000, 'a', midnight, 'cancelled');
  receipt('cancel-r', 'cancelled', 900000);
  sale('previous-day', 1, 'a', midnight - 1);
  receipt('old-r', 'previous-day', 1);
  sale('next-day', 1, 'a', midnight + 86400000);
  receipt('next-r', 'next-day', 1);
  sale('last-ms', 1, 'a', midnight + 86400000 - 1);
  receipt('last-r', 'last-ms', 1);
  sale('foreign-sale', 9000000, 'b');
  receipt('other-r', 'foreign-sale', 9000000, 'b');
  page = await read();
  assert.equal(page.totals.saleCount, 3);
  assert.equal(page.totals.receivedCents, 10001);
  assert.equal(page.totals.receiptCents, 10001);
  assert.equal((await read('b')).totals.saleCount, 1);
  assert.equal((await read('b')).totals.receiptCents, 9000000);
  assert.deepEqual((await read('empty')).items, []);
  assert.equal(overviewComparison((await read('empty')).totals), 'empty');
  assert.equal(
    (await read('a', 'q=foreign&saleId=foreign-sale')).totals.saleCount,
    3,
  );

  for (let i = 0; i < 43; i++) {
    sale(`p${i}`, i + 1, 'pages');
    receipt(`pr${i}`, `p${i}`, i + 1, 'pages');
  }
  const first = await read('pages');
  const second = await read(
    'pages',
    `cursor=${encodeURIComponent(first.nextCursor!)}`,
  );
  const third = await read(
    'pages',
    `cursor=${encodeURIComponent(second.nextCursor!)}`,
  );
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 20);
  assert.equal(third.items.length, 3);
  assert.equal(third.nextCursor, null);
  assert.equal(
    new Set(
      [...first.items, ...second.items, ...third.items].map((item) => item.id),
    ).size,
    43,
  );
  assert.equal(first.totals.receivedCents, 946);
  assert.deepEqual(first.totals, third.totals);
  sale('newest', 1, 'pages', midnight + 1);
  receipt('newest-r', 'newest', 1, 'pages');
  db.database
    .prepare("UPDATE sales SET status = 'cancelled' WHERE id = ?")
    .run(first.items[0].id);
  const changingSecond = await read(
    'pages',
    `cursor=${encodeURIComponent(first.nextCursor!)}`,
  );
  const changingThird = await read(
    'pages',
    `cursor=${encodeURIComponent(changingSecond.nextCursor!)}`,
  );
  assert.deepEqual(
    changingSecond.items.map((row) => row.id),
    second.items.map((row) => row.id),
  );
  assert.deepEqual(
    changingThird.items.map((row) => row.id),
    third.items.map((row) => row.id),
  );
  const endCursor = encodeURIComponent(
    JSON.stringify([third.items.at(-1)!.createdAt, third.items.at(-1)!.id]),
  );
  assert.equal((await read('pages', `cursor=${endCursor}`)).items.length, 0);
  await assert.rejects(read('a', 'cursor=invalid'));
  await assert.rejects(
    read('a', `cursor=${encodeURIComponent(JSON.stringify([-1, 'bad']))}`),
  );
  await assert.rejects(
    readOverview(
      db as unknown as D1Database,
      new URL('https://test/api/overview?period=invalid'),
      'a',
    ),
  );
  console.log(
    'Overview passed: payment/receipt comparison, no multiplication, partial/missing values, cancelling differences, cash, manual/OCR, date boundaries, metadata-only pagination and tenant isolation.',
  );
} finally {
  db.database.close();
}
