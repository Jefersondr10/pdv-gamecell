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
import type { ReceiptDocument } from '../lib/receipt-document.ts';
import {
  SALE_ALERT_SQL,
  SALE_AUTO_STATUS_SQL,
  SALE_CHECK_STATUS_SQL,
  SALE_ISSUE_KEYS_SQL,
} from '../lib/server/sale-status-sql.ts';

// Aggregate and filter predicates can share this fragment in one D1 statement.
// Keep enough headroom below the statement-size ceiling for both uses and the
// surrounding SELECT and filter clauses.
assert.ok(
  Buffer.byteLength(SALE_ALERT_SQL, 'utf8') < 45_000,
  'sale alert SQL must stay compact enough for D1 aggregates and filters',
);

const db = new SqliteDatabase(':memory:');
db.database
  .exec(`CREATE TABLE sales (id TEXT, store_id TEXT, status TEXT, products_total_cents INTEGER, received_total_cents INTEGER, order_status_id TEXT, created_at INTEGER);
CREATE TABLE sale_items (id TEXT, sale_id TEXT, store_id TEXT, sold_price_cents INTEGER);
CREATE TABLE attachments (id TEXT, sale_id TEXT, store_id TEXT, sale_item_id TEXT, kind TEXT, receipt_amount_cents INTEGER,receipt_review_reason TEXT,receipt_details_json TEXT);
CREATE TABLE receipt_ocr_jobs (attachment_id TEXT, status TEXT);
CREATE TABLE receipt_payment_links (attachment_id TEXT PRIMARY KEY, store_id TEXT, sale_id TEXT, payment_id TEXT, transaction_id TEXT, created_at INTEGER);
CREATE TABLE audit_events (store_id TEXT, action TEXT, entity_id TEXT, details_json TEXT);`);
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
  receipts: {
    receiptAmountCents: number | null;
    receiptOcrStatus?: string;
    receiptDetails?: ReceiptDocument;
    receiptReviewReason?: string;
  }[];
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
  const expectedAutomatic = key;
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
        .prepare(
          'INSERT INTO attachments(id,sale_id,store_id,sale_item_id,kind,receipt_amount_cents) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(`${itemId}-p${p}`, id, 'a', itemId, 'item_photo', null),
    );
    db.database
      .prepare(
        'INSERT INTO attachments(id,sale_id,store_id,sale_item_id,kind,receipt_amount_cents) VALUES (?, ?, ?, ?, ?, ?)',
      )
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
      .prepare(
        'INSERT INTO attachments(id,sale_id,store_id,sale_item_id,kind,receipt_amount_cents) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(rid, id, 'a', null, 'receipt', r.receiptAmountCents);
    db.database
      .prepare(
        'UPDATE attachments SET receipt_details_json=?,receipt_review_reason=? WHERE id=?',
      )
      .run(
        r.receiptDetails ? JSON.stringify(r.receiptDetails) : null,
        r.receiptReviewReason ?? null,
        rid,
      );
    if (r.receiptOcrStatus)
      db.database
        .prepare('INSERT INTO receipt_ocr_jobs VALUES (?, ?)')
        .run(rid, r.receiptOcrStatus);
  });
  db.database
    .prepare(
      'INSERT INTO attachments(id,sale_id,store_id,sale_item_id,kind,receipt_amount_cents) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(`${id}-foreign`, id, 'b', null, 'receipt', 99999);
  const sql = db.database
    .prepare(
      `SELECT ${SALE_CHECK_STATUS_SQL} AS status, ${SALE_AUTO_STATUS_SQL} AS automatic, ${SALE_ISSUE_KEYS_SQL} AS issues FROM sales s WHERE id=?`,
    )
    .get(id) as { status: string; automatic: string | null; issues: string };
  assert.equal(sql.status, key, `${id}: SQL`);
  assert.equal(sql.automatic, expectedAutomatic, `${id}: SQL automatic`);
  assert.deepEqual(
    JSON.parse(sql.issues).filter(Boolean),
    saleIssues(sale).map((issue) => issue.key),
    `${id}: all SQL/TS statuses agree`,
  );
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
add('pending_payment', (v) => {
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
const underpaid = add('pending_payment', (v) => {
  v.receipts[1].receiptAmountCents = 3999;
  v.receivedTotalCents = 9999;
});
assert.deepEqual(
  saleIssues(underpaid).map((issue) => issue.key),
  ['pending_payment'],
);
add('overpaid', (v) => {
  v.payments = [{ method: 'cash', amountCents: 10001 }];
  v.receipts = [];
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
  ['missing_price', 'missing_receipt', 'pending_payment', 'missing_photo'],
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
add('pending_payment', (v) => {
  mixed(v);
  v.receipts[0].receiptAmountCents = 409999;
});
const mixedUnderpaid = add('pending_payment', (v) => {
  mixed(v);
  v.payments[1].amountCents = 200000;
  v.receivedTotalCents = 610000;
});
assert.deepEqual(
  saleIssues(mixedUnderpaid).map((issue) => issue.key),
  ['pending_payment'],
);
const cashUnderpaid = add('missing_receipt', (v) => {
  mixed(v);
  v.payments = [{ method: 'cash', amountCents: 300000 }];
  v.receivedTotalCents = 300000;
  v.receipts = [];
});
assert.deepEqual(
  saleIssues(cashUnderpaid).map((issue) => issue.key),
  ['missing_receipt', 'pending_payment'],
);
// Re-reading remains visible even if the previous accepted value is preserved.
for (const status of ['pending', 'processing', 'retry']) {
  const rereading = add('reading', (v) => {
    v.receipts[0].receiptOcrStatus = status;
  });
  assert.deepEqual(
    saleIssues(rereading).map((issue) => issue.key),
    ['reading'],
  );
}
add('overpaid', (v) => {
  v.receipts[0].receiptAmountCents = 6001;
});
const validDoc = (): ReceiptDocument => ({
  version: 1,
  state: 'completed',
  automaticEligible: true,
  alternateTransactionId: null,
  observedTransactionId: null,
  ambiguous: false,
  blocked: false,
  payerName: 'Cliente sintético',
  payerBank: 'Banco sintético',
  recipientName: 'Loja sintética',
  recipientBank: 'Banco de teste',
  recipientDocument: null,
  transactionId: null,
  paidAtText: null,
});
// Informational metadata omissions do not erase an otherwise accepted payment.
add('reconciled', (v) => {
  v.receipts[0].receiptDetails = validDoc();
});
for (const state of ['scheduled', 'cancelled'] as const) {
  add('review', (v) => {
    v.receipts[0].receiptDetails = {
      ...validDoc(),
      state,
      automaticEligible: false,
    };
  });
}
add('review', (v) => {
  v.receipts[0].receiptDetails = {
    ...validDoc(),
    ambiguous: true,
    automaticEligible: false,
  };
});
add('review', (v) => {
  v.receipts[0].receiptDetails = { ...validDoc(), automaticEligible: false };
});
add('review', (v) => {
  v.receipts.forEach((receipt) => {
    receipt.receiptDetails = {
      ...validDoc(),
      transactionId: `E${'9'.repeat(31)}`,
    };
  });
});
const simultaneous = add('review', (v) => {
  v.receipts[0].receiptReviewReason = 'Identificação da transação mudou.';
  v.receipts[1] = { receiptAmountCents: null, receiptOcrStatus: 'processing' };
});
assert.deepEqual(
  saleIssues(simultaneous).map((issue) => issue.key),
  ['review', 'reading', 'pending_payment'],
);
add('cancelled', (v) => {
  v.status = 'cancelled';
  v.receipts[0].receiptDetails = { ...validDoc(), blocked: true };
  v.receipts[1].receiptOcrStatus = 'processing';
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
        : ['cancelled', 'reconciled'].includes(key)
          ? f.key === key
          : saleIssues({
              ...f.value,
              reconciliation: deriveReceiptReconciliation(
                f.value.receipts,
                f.value.productsTotalCents,
              ),
            }).some((issue) => issue.key === key),
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
  SALE_CHECK_STATUSES.map((s) => s.key),
);
assert.equal(isAutomaticStatusName(' Pagamento pendente '), true);
assert.equal(isAutomaticStatusName('Falta comprovante'), true);
assert.equal(isAutomaticStatusName('Aguardando retirada'), false);
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
assert.equal(saleDisplayStatus(withManual).label, 'Falta preço de venda');
assert.equal(saleDisplayStatus(withManual).key, 'missing_price');
assert.equal(saleIssues(withManual).length, 4);
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
  'missing_photo',
);
assert.equal(
  saleDisplayStatus({
    ...withManual,
    orderStatus: { ...selected, name: 'Conciliado' },
  }).key,
  'missing_price',
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
  assert.equal(rows.length, scope === 'saved' ? fixtures.length : 0);
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
const manualId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
db.database.exec('UPDATE order_statuses SET active=0');
assert.deepEqual(
  matchingIds(manualId),
  [],
  'saved labels never override computed statuses',
);
assert.deepEqual(matchingIds('none'), []);
for (const name of ['conciliado', 'cancelado']) {
  db.database
    .prepare('UPDATE order_statuses SET name=?, name_normalized=?')
    .run(name, name);
  assert.deepEqual(
    matchingIds('none'),
    [],
    'reserved registration is not a manual display status',
  );
  assert.deepEqual(matchingIds(manualId), []);
  assert.equal(matchingIds(manualId, 'saved').length, fixtures.length);
}
db.database.exec(
  "UPDATE order_statuses SET store_id='b', name='Pagamento pendente', name_normalized='pagamento pendente'",
);
assert.deepEqual(matchingIds('none'), [], 'foreign registration ignored');
assert.deepEqual(matchingIds(manualId), []);
db.database.exec('DELETE FROM order_statuses');
assert.deepEqual(matchingIds('none'), [], 'orphan ignored');
db.database.exec('UPDATE sales SET order_status_id=NULL');
assert.deepEqual(matchingIds('none'), []);
assert.equal(matchingIds('none', 'saved').length, fixtures.length);
db.close();
console.log(
  'Automatic statuses: TS/SQL parity, filter aliases, every missing field, concurrent issues, repricing and tenant boundaries passed.',
);
