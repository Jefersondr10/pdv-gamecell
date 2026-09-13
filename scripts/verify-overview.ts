import assert from 'node:assert/strict';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import { readOverview } from '../lib/server/overview.ts';
import { overviewComparison, overviewSaleComparison } from '../lib/overview.ts';

const db = new SqliteDatabase(':memory:');
db.database.exec(`
  CREATE TABLE sales (id TEXT PRIMARY KEY, store_id TEXT, number INTEGER, customer_name TEXT, created_at INTEGER, status TEXT, received_total_cents INTEGER, products_total_cents INTEGER);
  CREATE TABLE attachments (id TEXT PRIMARY KEY, store_id TEXT, sale_id TEXT, kind TEXT, file_name TEXT, mime_type TEXT, size_bytes INTEGER, receipt_amount_cents INTEGER, receipt_amount_source TEXT, receipt_amount_confirmed_at INTEGER, created_at INTEGER,receipt_review_reason TEXT);
  CREATE TABLE payments (id TEXT, store_id TEXT, sale_id TEXT, method TEXT, amount_cents INTEGER);
  CREATE TABLE receipt_ocr_jobs (attachment_id TEXT PRIMARY KEY, status TEXT);
  CREATE TABLE sale_items (id TEXT, sale_id TEXT, store_id TEXT, sold_price_cents INTEGER);
  ALTER TABLE attachments ADD COLUMN sale_item_id TEXT;
  ALTER TABLE sales ADD COLUMN order_status_id TEXT;
  CREATE TABLE order_statuses (id TEXT, store_id TEXT, name TEXT, color TEXT);
  ALTER TABLE attachments ADD COLUMN receipt_details_json TEXT;
  CREATE TABLE receipt_payment_links(attachment_id TEXT,store_id TEXT,sale_id TEXT,payment_id TEXT,transaction_id TEXT);
  CREATE TABLE audit_events(store_id TEXT,action TEXT,entity_id TEXT,details_json TEXT);
`);
const midnight = Date.parse('2026-09-05T00:00:00-03:00');
const sale = (
  id: string,
  paid: number,
  store = 'a',
  time = midnight,
  status = 'completed',
) => {
  db.database
    .prepare(
      'INSERT INTO sales(id,store_id,number,customer_name,created_at,status,received_total_cents,products_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, store, 1, `Cliente ${id}`, time, status, paid, paid);
  db.database
    .prepare('INSERT INTO sale_items VALUES (?, ?, ?, ?)')
    .run(`${id}-item`, id, store, paid);
  if (paid > 0)
    db.database
      .prepare('INSERT INTO payments VALUES (?, ?, ?, ?, ?)')
      .run(`${id}-default-pay`, store, id, 'pix', paid);
};
const receipt = (
  id: string,
  saleId: string,
  amount: number | null,
  store = 'a',
  source = 'ocr',
  kind = 'receipt',
) =>
  db.database
    .prepare(
      'INSERT INTO attachments (id,store_id,sale_id,kind,file_name,mime_type,size_bytes,receipt_amount_cents,receipt_amount_source,receipt_amount_confirmed_at,created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
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
  db.database.exec("DELETE FROM payments WHERE sale_id='one'");
  payment('pay1', 'one', 6000);
  payment('pay2', 'one', 4000, 'cash');
  receipt('r1', 'one', 3000);
  receipt('r2', 'one', 3000, 'a', 'manual');
  db.database.exec(
    "INSERT INTO receipt_ocr_jobs VALUES ('r2', 'cancelled'); INSERT INTO sale_items VALUES ('i1', 'one', 'a', 6000), ('i2', 'one', 'a', 4000);",
  );
  receipt('photo', 'one', 999999, 'a', 'ocr', 'item_photo');
  // Defensively tenant-filter attachments and payments even for bad foreign rows.
  receipt('foreign-file', 'one', 999999, 'b');
  payment('foreign-pay', 'one', 999999, 'cash', 'b');
  let page = await read();
  assert.deepEqual(page.totals, {
    receiptReviewCount: 0,
    saleCount: 1,
    receivedCents: 10000,
    cashCents: 4000,
    pixCents: 6000,
    receiptCents: 6000,
    receiptCount: 2,
    pendingCount: 0,
    missingCount: 0,
    divergentCount: 0,
    shortfallCents: 0,
    surplusCents: 0,
    saleDifferenceCount: 0,
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
  assert.equal(page.totals.shortfallCents, 100);
  assert.equal(page.totals.surplusCents, 100);
  assert.equal((await read('offset', 'comparison=matched')).items.length, 0);
  assert.equal((await read('offset', 'comparison=divergent')).items.length, 2);
  assert.equal((await read('offset', 'comparison=review')).items.length, 2);
  sale('offset-pending', 1000, 'offset');
  receipt('offset-pending-r', 'offset-pending', null, 'offset');
  assert.equal(overviewComparison((await read('offset')).totals), 'review');

  receipt('pending', 'one', null);
  db.database.exec(
    "INSERT INTO receipt_ocr_jobs VALUES ('pending', 'needs_review');",
  );
  page = await read();
  assert.equal(page.totals.pendingCount, 1);
  assert.equal(page.totals.divergentCount, 0);
  assert.equal(page.totals.receiptCents, 6000);
  assert.equal(overviewComparison(page.totals), 'pending');
  sale('missing', 1);
  payment('missing-pix', 'missing', 1);
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
  assert.equal(page.totals.receiptCents, 6001);
  assert.equal((await read('b')).totals.saleCount, 1);
  assert.equal((await read('b')).totals.receiptCents, 9000000);
  assert.deepEqual((await read('empty')).items, []);
  assert.equal(overviewComparison((await read('empty')).totals), 'empty');
  assert.equal(
    (await read('a', 'q=foreign&saleId=foreign-sale')).totals.saleCount,
    3,
  );
  for (const [filter, ids] of [
    ['matched', ['last-ms']],
    ['pending', ['one']],
    ['missing', ['missing']],
    ['divergent', ['missing']],
  ] as const) {
    const filtered = await read('a', `comparison=${filter}`);
    assert.deepEqual(
      filtered.items.map((item) => item.id),
      ids,
    );
    assert.equal(filtered.totals.saleCount, ids.length);
  }
  assert.equal(
    overviewSaleComparison((await read('a', 'comparison=matched')).items[0]),
    'matched',
  );
  assert.equal(
    overviewSaleComparison((await read('a', 'comparison=pending')).items[0]),
    'pending',
  );
  assert.equal(
    overviewSaleComparison((await read('a', 'comparison=missing')).items[0]),
    'missing',
  );
  const differences = (await read('offset', 'comparison=divergent')).items;
  assert.deepEqual(differences.map(overviewSaleComparison).sort(), [
    'above',
    'below',
    'pending',
  ]);
  // Receipt synchronization must not hide the remaining gap to the sale price.
  sale('lumora', 3465000, 'lumora');
  receipt('lumora1', 'lumora', 1500000, 'lumora');
  receipt('lumora2', 'lumora', 1965000, 'lumora');
  db.database.exec(
    "UPDATE sales SET products_total_cents=3473000 WHERE id='lumora'; UPDATE sale_items SET sold_price_cents=3473000 WHERE sale_id='lumora'",
  );
  const lumora = await read('lumora', 'comparison=review');
  assert.equal(lumora.items.length, 1);
  assert.equal(lumora.items[0].automaticStatus, null);
  assert.ok(lumora.items[0].issueKeys.includes('pending_payment'));
  assert.equal(overviewSaleComparison(lumora.items[0]), 'below');
  assert.equal(overviewComparison(lumora.totals), 'review');
  assert.equal(
    (await read('lumora', 'comparison=matched')).totals.saleCount,
    0,
  );
  assert.equal(
    (await read('lumora', 'comparison=divergent')).totals.saleCount,
    1,
  );
  assert.equal(lumora.totals.saleDifferenceCount, 1);
  for (const invalidAmount of [0, -1, 0.5]) {
    const fixture = `invalid-${invalidAmount}`;
    sale(fixture, 100, fixture);
    receipt(`${fixture}-r`, fixture, invalidAmount, fixture);
    assert.equal(
      (await read(fixture, 'comparison=pending')).totals.saleCount,
      1,
    );
    assert.equal(
      (await read(fixture, 'comparison=review')).totals.saleCount,
      1,
    );
    assert.equal(
      (await read(fixture, 'comparison=matched')).totals.saleCount,
      0,
    );
  }
  sale('no-price', 100, 'no-price');
  receipt('no-price-r', 'no-price', 100, 'no-price');
  db.database.exec(
    "UPDATE sale_items SET sold_price_cents=0 WHERE sale_id='no-price'",
  );
  const noPrice = await read('no-price', 'comparison=divergent');
  assert.equal(noPrice.items[0].automaticStatus, null);
  assert.ok(noPrice.items[0].issueKeys.includes('missing_price'));
  assert.equal(overviewSaleComparison(noPrice.items[0]), 'missing_price');
  assert.equal(
    (await read('no-price', 'comparison=matched')).totals.saleCount,
    0,
  );
  sale('no-receipt', 100, 'no-receipt');
  assert.equal(
    (await read('no-receipt', 'comparison=review')).totals.saleCount,
    1,
  );
  assert.equal(
    (await read('no-receipt', 'comparison=missing')).totals.saleCount,
    1,
  );
  sale('paid-gap', 80, 'paid-gap');
  receipt('paid-gap-r', 'paid-gap', 100, 'paid-gap');
  db.database.exec(
    "UPDATE sales SET products_total_cents=100 WHERE id='paid-gap'; UPDATE sale_items SET sold_price_cents=100 WHERE sale_id='paid-gap'",
  );
  const paidGap = await read('paid-gap', 'comparison=matched');
  assert.equal(
    paidGap.items[0].receivedCents,
    100,
    'legacy Pix rows do not override receipt income',
  );
  assert.ok(!paidGap.items[0].issueKeys.includes('pending_payment'));
  assert.equal(paidGap.totals.saleCount, 1);
  assert.equal(
    (await read('paid-gap', 'comparison=matched')).totals.saleCount,
    1,
  );
  // The filter precedes pagination and totals; newer unmatched sales cannot hide matches.
  for (let i = 0; i < 45; i++) {
    sale(`f${i}`, 100, 'filtered', midnight + i);
    receipt(`fr${i}`, `f${i}`, i % 2 === 0 ? 100 : null, 'filtered');
  }
  const filteredFirst = await read('filtered', 'comparison=matched');
  const filteredSecond = await read(
    'filtered',
    `comparison=matched&cursor=${encodeURIComponent(filteredFirst.nextCursor!)}`,
  );
  assert.equal(filteredFirst.items.length, 20);
  assert.equal(filteredSecond.items.length, 3);
  assert.equal(filteredFirst.totals.saleCount, 23);
  assert.equal(filteredFirst.pendingInPeriod, 22);
  assert.equal(filteredFirst.totals.receivedCents, 2300);
  assert.deepEqual(filteredFirst.totals, filteredSecond.totals);
  assert.equal(
    new Set(
      [...filteredFirst.items, ...filteredSecond.items].map((item) => item.id),
    ).size,
    23,
  );
  // OCR completing moves the sale between filters immediately on reload.
  db.database.exec(
    "UPDATE attachments SET receipt_amount_cents = 100 WHERE id = 'fr1'",
  );
  assert.equal(
    (await read('filtered', 'comparison=matched')).totals.saleCount,
    24,
  );
  assert.equal(
    (await read('filtered', 'comparison=pending')).totals.saleCount,
    21,
  );
  await assert.rejects(
    read('a', 'comparison=wrong'),
    (error: unknown) =>
      error instanceof Error && 'status' in error && error.status === 400,
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
  sale('manual-warning', 10000, 'statuses');
  receipt('manual-receipt', 'manual-warning', 10000, 'statuses');
  db.database
    .exec(`INSERT INTO order_statuses VALUES ('manual', 'statuses', 'Pagamento pendente', 'amber');
    UPDATE sales SET order_status_id='manual' WHERE id='manual-warning'`);
  let manualOverview = (await read('statuses')).items[0];
  assert.equal(manualOverview.displayStatus.key, 'manual');
  assert.equal(manualOverview.displayStatus.label, 'Pagamento pendente');
  assert.deepEqual(manualOverview.issueKeys, ['missing_photo']);
  receipt(
    'manual-photo',
    'manual-warning',
    null,
    'statuses',
    'ocr',
    'item_photo',
  );
  db.database.exec(
    "UPDATE attachments SET sale_item_id='manual-warning-item' WHERE id='manual-photo'",
  );
  manualOverview = (await read('statuses')).items[0];
  assert.equal(manualOverview.displayStatus.key, 'reconciled');
  assert.deepEqual(manualOverview.issueKeys, []);
  db.database.exec(
    "UPDATE sales SET received_total_cents=9000 WHERE id='manual-warning'",
  );
  manualOverview = (await read('statuses')).items[0];
  assert.equal(
    manualOverview.displayStatus.key,
    'reconciled',
    'stale legacy total cannot override accepted receipt income',
  );
  assert.deepEqual(manualOverview.issueKeys, []);
  // Real-world mix: only Pix is compared with receipts; cash stays manual.
  sale('mixed-cash', 710000, 'mixed');
  db.database.exec(
    "UPDATE payments SET amount_cents=410000 WHERE sale_id='mixed-cash'",
  );
  payment('mixed-money', 'mixed-cash', 300000, 'cash', 'mixed');
  receipt('mixed-proof', 'mixed-cash', 410000, 'mixed');
  const mixed = await read('mixed', 'comparison=matched');
  assert.equal(mixed.items.length, 1);
  assert.equal(mixed.totals.pixCents, 410000);
  assert.equal(mixed.totals.receivedCents, 710000);
  assert.equal(mixed.totals.divergentCount, 0);
  assert.equal(overviewSaleComparison(mixed.items[0]), 'matched');
  sale('cash-only', 710000, 'cash-only');
  db.database.exec(
    "UPDATE payments SET method='cash' WHERE sale_id='cash-only'",
  );
  const cashOnly = await read('cash-only', 'comparison=matched');
  assert.equal(cashOnly.items.length, 1);
  assert.equal(overviewSaleComparison(cashOnly.items[0]), 'not_required');
  assert.equal((await read('cash-only', 'comparison=missing')).items.length, 0);
  db.database.exec(
    "UPDATE order_statuses SET store_id='foreign' WHERE id='manual'",
  );
  db.database.exec(
    "UPDATE sales SET products_total_cents=11000 WHERE id='manual-warning'",
  );
  assert.equal((await read('statuses')).items[0].displayStatus.key, 'none');
  console.log(
    'Overview passed: payment/receipt comparison, no multiplication, partial/missing values, cancelling differences, cash, manual/OCR, date boundaries, metadata-only pagination and tenant isolation.',
  );
} finally {
  db.database.close();
}
