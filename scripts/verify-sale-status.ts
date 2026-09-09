import assert from 'node:assert/strict';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import {
  SYSTEM_SALE_STATUSES,
  SALE_CHECK_STATUSES,
  saleCheckStatus,
  automaticSaleStatus,
  isAutomaticStatusName,
  saleDisplayStatus,
  saleIssues,
} from '../lib/sale-display-status.ts';
import { deriveReceiptReconciliation } from '../lib/receipt-reconciliation.ts';
import { parseSalesFilters } from '../lib/server/sales-filters.ts';
import {
  SALE_AUTO_STATUS_SQL,
  SALE_CHECK_STATUS_SQL,
} from '../lib/server/sale-status-sql.ts';

const db = new SqliteDatabase(':memory:');
db.database
  .exec(`CREATE TABLE sales (id TEXT, store_id TEXT, status TEXT, products_total_cents INTEGER, received_total_cents INTEGER, order_status_id TEXT, created_at INTEGER);
CREATE TABLE sale_items (id TEXT, sale_id TEXT, store_id TEXT, sold_price_cents INTEGER);
CREATE TABLE attachments (id TEXT, sale_id TEXT, store_id TEXT, sale_item_id TEXT, kind TEXT, receipt_amount_cents INTEGER);
CREATE TABLE receipt_ocr_jobs (attachment_id TEXT, status TEXT);`);
db.database.exec(
  'CREATE TABLE payments (id TEXT, sale_id TEXT, store_id TEXT, method TEXT, amount_cents INTEGER)',
);
db.database.exec(
  `CREATE TABLE order_statuses (id TEXT, store_id TEXT, name TEXT, name_normalized TEXT, active INTEGER)`,
);
type Fixture = {
  status: 'completed' | 'cancelled';
  productsTotalCents: number;
  receivedTotalCents: number;
  payments: { method: string; amountCents: number }[];
  items: { soldPriceCents: number; photos: unknown[] }[];
  receipts: { receiptAmountCents: number | null; receiptOcrStatus?: string }[];
};
const base = (): Fixture => ({
  status: 'completed',
  productsTotalCents: 10000,
  receivedTotalCents: 10000,
  payments: [{ method: 'pix', amountCents: 10000 }],
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
  assert.equal(saleCheckStatus(sale).key, key, `${id}: first check`);
  const expectedAutomatic = ['cancelled', 'reconciled'].includes(key)
    ? key
    : null;
  assert.equal(automaticSaleStatus(sale)?.key ?? null, expectedAutomatic);
  assert.equal(saleDisplayStatus(sale).key, expectedAutomatic ?? 'none');
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
  value.payments.forEach((payment, index) =>
    db.database
      .prepare('INSERT INTO payments VALUES (?, ?, ?, ?, ?)')
      .run(`${id}-pay${index}`, id, 'a', payment.method, payment.amountCents),
  );
  db.database
    .prepare('INSERT INTO payments VALUES (?, ?, ?, ?, ?)')
    .run(`${id}-foreign-pay`, id, 'b', 'pix', 999999);
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
    .prepare(
      `SELECT ${SALE_CHECK_STATUS_SQL} AS status, ${SALE_AUTO_STATUS_SQL} AS automatic FROM sales s WHERE id=?`,
    )
    .get(id) as { status: string; automatic: string | null };
  assert.equal(sql.status, key, `${id}: SQL`);
  assert.equal(sql.automatic, expectedAutomatic, `${id}: SQL automatic`);
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
add('review', (v) => {
  v.receipts[0].receiptAmountCents = 0.5;
  v.receipts[1].receiptAmountCents = 9999.5;
});
add('review', (v) => {
  v.receipts[0].receiptAmountCents = Number.MAX_SAFE_INTEGER + 1;
});
const multiple = add('missing_price', (v) => {
  v.items[0].soldPriceCents = 0;
  v.productsTotalCents = 4000;
  v.receipts = [];
  v.receivedTotalCents = 0;
  v.payments = [];
  v.items[1].photos = [];
});
assert.deepEqual(
  saleIssues(multiple).map((s) => s.key),
  ['missing_price', 'pending_payment', 'missing_photo'],
);
const mixed = (v: Fixture) => {
  v.productsTotalCents = v.receivedTotalCents = 710000;
  v.items = [{ soldPriceCents: 710000, photos: [{}] }];
  v.payments = [
    { method: 'pix', amountCents: 410000 },
    { method: 'cash', amountCents: 300000 },
  ];
  v.receipts = [{ receiptAmountCents: 410000 }];
};
add('reconciled', mixed);
add('reconciled', (v) => {
  mixed(v);
  v.payments = [{ method: 'cash', amountCents: 710000 }];
  v.receipts = [];
});
add('missing_receipt', (v) => {
  mixed(v);
  v.receipts = [];
});
add('review', (v) => {
  mixed(v);
  v.receipts[0].receiptAmountCents = 409999;
});
add('pending_payment', (v) => {
  mixed(v);
  v.payments[1].amountCents = 200000;
  v.receivedTotalCents = 610000;
});
add('pending_payment', (v) => {
  mixed(v);
  v.payments = [{ method: 'cash', amountCents: 300000 }];
  v.receivedTotalCents = 300000;
  v.receipts = [];
});
for (const key of [
  ...SALE_CHECK_STATUSES.map((s) => s.key),
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
  ['pending_payment'],
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
assert.deepEqual(
  SYSTEM_SALE_STATUSES.map((s) => s.key),
  ['cancelled', 'reconciled'],
);
assert.equal(isAutomaticStatusName(' Pagamento pendente '), false);
assert.equal(isAutomaticStatusName('Ｃｏｎｃｉｌｉａｄｏ'), true);
assert.equal(isAutomaticStatusName('cancelado'), true);
assert.equal(isAutomaticStatusName('  CONCILIADO '), true);
assert.equal(isAutomaticStatusName('Conciliádo'), false);
const selected = {
  id: 'manual',
  name: 'Pagamento pendente',
  color: 'amber' as const,
};
const withManual = { ...multiple, orderStatus: selected };
assert.equal(saleDisplayStatus(withManual).label, selected.name);
assert.equal(saleDisplayStatus(withManual).key, 'manual');
assert.equal(saleIssues(withManual).length, 3);
const complete = {
  ...base(),
  orderStatus: selected,
  reconciliation: deriveReceiptReconciliation(base().receipts, 10000),
};
assert.equal(saleDisplayStatus(complete).key, 'reconciled');
assert.equal(
  saleDisplayStatus({ ...complete, status: 'cancelled' }).key,
  'cancelled',
);
assert.equal(
  saleDisplayStatus({
    ...complete,
    items: complete.items.map((i) => ({ ...i, photos: [] })),
  }).key,
  'manual',
);
assert.equal(
  saleDisplayStatus({
    ...withManual,
    orderStatus: { ...selected, name: 'Conciliado' },
  }).key,
  'none',
);
// New display filters agree with the visible status; old links retain the saved assignment.
db.database.exec(
  "UPDATE sales SET order_status_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'",
);
db.database.exec(
  "INSERT INTO order_statuses VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a','Pagamento pendente','pagamento pendente',1)",
);
for (const scope of ['saved', 'display']) {
  const filter = parseSalesFilters(
    new URL(
      `https://example.test/?period=all&orderStatus=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa&statusScope=${scope}`,
    ),
    'a',
  );
  const rows = db.database
    .prepare(`SELECT id FROM sales s WHERE ${filter.where.join(' AND ')}`)
    .all(...filter.bindings);
  assert.equal(
    rows.length,
    scope === 'saved'
      ? fixtures.length
      : fixtures.filter((f) => !['reconciled', 'cancelled'].includes(f.key))
          .length,
  );
}
const matchingIds = (status: string, scope = 'display') => {
  const filter = parseSalesFilters(
    new URL(
      `https://example.test/?period=all&orderStatus=${status}&statusScope=${scope}`,
    ),
    'a',
  );
  return (
    db.database
      .prepare(
        `SELECT s.id FROM sales s WHERE ${filter.where.join(' AND ')} ORDER BY s.id`,
      )
      .all(...filter.bindings) as { id: string }[]
  ).map((row) => row.id);
};
const pendingIds = fixtures
  .filter((f) => !['reconciled', 'cancelled'].includes(f.key))
  .map((f) => f.id)
  .sort();
const manualId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
db.database.exec('UPDATE order_statuses SET active=0');
assert.deepEqual(
  matchingIds(manualId),
  pendingIds,
  'inactive assignment stays visible',
);
assert.deepEqual(matchingIds('none'), []);
for (const name of ['conciliado', 'cancelado']) {
  db.database
    .prepare('UPDATE order_statuses SET name=?, name_normalized=?')
    .run(name, name);
  assert.deepEqual(
    matchingIds('none'),
    pendingIds,
    'reserved registration is not a manual display status',
  );
  assert.deepEqual(matchingIds(manualId), []);
  assert.equal(matchingIds(manualId, 'saved').length, fixtures.length);
}
db.database.exec(
  "UPDATE order_statuses SET store_id='b', name='Pagamento pendente', name_normalized='pagamento pendente'",
);
assert.deepEqual(
  matchingIds('none'),
  pendingIds,
  'foreign registration ignored',
);
assert.deepEqual(matchingIds(manualId), []);
db.database.exec('DELETE FROM order_statuses');
assert.deepEqual(matchingIds('none'), pendingIds, 'orphan ignored');
db.database.exec('UPDATE sales SET order_status_id=NULL');
assert.deepEqual(matchingIds('none'), pendingIds);
assert.equal(matchingIds('none', 'saved').length, fixtures.length);
db.close();
console.log(
  'Automatic statuses: TS/SQL parity, filter aliases, every missing field, concurrent issues, repricing and tenant boundaries passed.',
);
