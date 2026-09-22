import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import {
  readReceiptConflicts,
  readSaleActivity,
} from '../lib/server/sale-activity.ts';
import { presentSaleActivity } from '../lib/sale-activity.ts';
import { routePermissions } from '../lib/server/permissions.ts';
import { salePendingItems } from '../lib/sale-pending-actions.ts';
import { deriveReceiptReconciliation } from '../lib/receipt-reconciliation.ts';
import type { SaleRecord } from '../lib/pdv-types.ts';

const adapter = new SqliteDatabase(':memory:');
const db = adapter as unknown as D1Database;
adapter.database
  .exec(`CREATE TABLE sales(id TEXT PRIMARY KEY,store_id TEXT,number INTEGER,customer_name TEXT,status TEXT);
CREATE TABLE users(id TEXT PRIMARY KEY,store_id TEXT,display_name TEXT);
CREATE TABLE audit_events(id TEXT PRIMARY KEY,store_id TEXT,actor_user_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT,details_json TEXT,created_at INTEGER);
CREATE TABLE attachments(id TEXT PRIMARY KEY,store_id TEXT,sale_id TEXT,kind TEXT,receipt_details_json TEXT);
CREATE TABLE receipt_payment_links(attachment_id TEXT,store_id TEXT,sale_id TEXT,transaction_id TEXT);
INSERT INTO sales VALUES('sale','shop',1,'Cliente A','completed'),('related','shop',2,'Cliente B','completed'),('cancelled','shop',3,'Cancelada','cancelled'),('foreign','other',4,'Segredo','completed');
INSERT INTO users VALUES('operator','shop','Operador de teste'),('foreign-user','other','Usuário secreto');`);
const add = adapter.database.prepare(
  'INSERT INTO audit_events VALUES(?,?,?,?,?,?,?,?)',
);
for (let index = 0; index < 35; index++)
  add.run(
    `event-${String(index).padStart(2, '0')}`,
    'shop',
    'operator',
    'sale.date_changed',
    'sale',
    'sale',
    JSON.stringify({
      before: { createdAt: 1790000000000 },
      after: { createdAt: 1790000060000 },
      fingerprint: 'DO_NOT_EXPOSE',
    }),
    1790000100000,
  );
add.run(
  'foreign-audit',
  'other',
  'foreign-user',
  'sale.cancelled',
  'sale',
  'sale',
  JSON.stringify({ reason: 'FOREIGN_SECRET' }),
  1790000100001,
);
add.run(
  'foreign-actor',
  'shop',
  'foreign-user',
  'sale.attachments_added',
  'sale',
  'sale',
  JSON.stringify({ receiptsAdded: 1 }),
  1790000100002,
);
add.run(
  'malformed',
  'shop',
  'operator',
  'sale.created',
  'sale',
  'sale',
  'not-json',
  1790000100003,
);
add.run(
  'unrelated-event',
  'shop',
  'operator',
  'session.created',
  'session',
  'sale',
  JSON.stringify({ token: 'DO_NOT_EXPOSE' }),
  1790000100004,
);
const before = adapter.database
  .prepare('SELECT * FROM audit_events ORDER BY id')
  .all();
const first = await readSaleActivity(db, 'shop', 'sale');
assert.equal(first.items.length, 30);
assert.ok(first.nextCursor);
assert.equal(first.items[0].title, 'Venda registrada');
assert.equal(first.items[1].actor, 'Operador não identificado');
const second = await readSaleActivity(db, 'shop', 'sale', first.nextCursor);
assert.equal(second.items.length, 7);
assert.equal(second.nextCursor, null);
assert.equal(
  new Set([...first.items, ...second.items].map((item) => item.id)).size,
  37,
);
assert.ok(first.items.some((item) => item.changes[0]?.before.includes('2026')));
assert.doesNotMatch(
  JSON.stringify([first, second]),
  /DO_NOT_EXPOSE|FOREIGN_SECRET|Usuário secreto|details_json|fingerprint/,
);
await assert.rejects(() => readSaleActivity(db, 'shop', 'foreign'), {
  code: 'SALE_NOT_FOUND',
});
await assert.rejects(() => readSaleActivity(db, 'shop', 'sale', 'oops'), {
  code: 'INVALID_CURSOR',
});
await assert.rejects(() => readSaleActivity(db, 'shop', 'sale', '-1:foo'), {
  code: 'INVALID_CURSOR',
});
assert.deepEqual(
  adapter.database.prepare('SELECT * FROM audit_events ORDER BY id').all(),
  before,
);

const event = (action: string, details: unknown) =>
  presentSaleActivity({
    id: 'test',
    actor: 'Teste',
    action,
    createdAt: 1790000000000,
    details: JSON.stringify(details),
  });
assert.deepEqual(
  event('sale.participants_changed', {
    before: { customerName: 'Ana', sellerName: 'José' },
    after: { customerName: 'Bia', sellerName: 'José' },
  }).changes,
  [{ label: 'Cliente', before: 'Ana', after: 'Bia' }],
);
assert.equal(
  event('sale.prices_changed', {
    before: {
      totalCents: 10000,
      items: [{ id: 'i', serial: 'TESTSN', soldPriceCents: 10000 }],
    },
    after: {
      totalCents: 9000,
      items: [{ id: 'i', serial: 'TESTSN', soldPriceCents: 9000 }],
    },
  }).changes.length,
  2,
);
assert.equal(
  event('sale.payments_corrected', {
    before: [{ id: 'cash', method: 'cash', amountCents: 10000 }],
    after: [{ id: 'cash', method: 'cash', amountCents: 5000 }],
  }).changes.length,
  2,
);
assert.equal(
  event('sale.payment_from_receipts', {
    before: [{ id: 'cash', amountCents: 1000 }],
    receivedTotalCents: 6000,
  }).changes[0].after.replace(/\s/g, ''),
  'R$60,00',
);
assert.equal(
  event('sale.payment_from_receipts', { before: [], receivedTotalCents: 6000 })
    .automatic,
  true,
);
assert.match(
  event('sale.order_status_changed', {
    previousOrderStatusId: 'a',
    orderStatusId: 'b',
  }).notes[0],
  /não foram registrados/,
);
assert.equal(
  event('sale.order_status_changed', {
    previousOrderStatusName: 'Separando',
    orderStatusName: 'Entregue',
  }).changes[0].after,
  'Entregue',
);
assert.match(
  event('sale.receipt_deleted', {
    before: { name: 'comprovante.pdf', amountCents: 5000 },
  }).notes.join(' '),
  /comprovante.pdf/,
);

const attachment = adapter.database.prepare(
  'INSERT INTO attachments VALUES(?,?,?,?,?)',
);
attachment.run(
  'own',
  'shop',
  'sale',
  'receipt',
  JSON.stringify({
    transactionId: 'transaction',
    alternateTransactionId: 'alternate',
  }),
);
attachment.run(
  'same',
  'shop',
  'sale',
  'receipt',
  JSON.stringify({ transactionId: 'transaction' }),
);
attachment.run(
  'other',
  'shop',
  'related',
  'receipt',
  JSON.stringify({ alternateTransactionId: 'alternate' }),
);
attachment.run(
  'cancelled-proof',
  'shop',
  'cancelled',
  'receipt',
  JSON.stringify({ transactionId: 'transaction' }),
);
attachment.run(
  'foreign-proof',
  'other',
  'foreign',
  'receipt',
  JSON.stringify({ transactionId: 'transaction' }),
);
attachment.run('invalid-json', 'shop', 'related', 'receipt', 'bad-json');
adapter.database
  .prepare('INSERT INTO receipt_payment_links VALUES(?,?,?,?)')
  .run('linked', 'shop', 'related', 'transaction');
add.run(
  'claim',
  'shop',
  'operator',
  'sale.receipt_transaction_claimed',
  'attachment',
  'archived-proof',
  JSON.stringify({ saleId: 'related', transactionId: 'transaction' }),
  1790000100000,
);
const conflicts = await readReceiptConflicts(db, 'shop', 'sale');
assert.ok(conflicts.items.some((item) => item.saleId === 'sale'));
assert.ok(conflicts.items.some((item) => item.otherReceiptId === 'linked'));
assert.ok(
  conflicts.items.some((item) => item.otherReceiptId === 'archived-proof'),
);
assert.ok(conflicts.items.some((item) => item.otherReceiptId === 'other'));
assert.ok(
  conflicts.items.every(
    (item) =>
      item.saleId !== 'foreign' &&
      item.saleId !== 'cancelled' &&
      item.receiptId !== item.otherReceiptId,
  ),
);
await assert.rejects(() => readReceiptConflicts(db, 'shop', 'foreign'), {
  code: 'SALE_NOT_FOUND',
});
for (const suffix of ['history', 'receipt-conflicts']) {
  assert.deepEqual(
    routePermissions(
      new Request(`https://example.test/api/sales/sale/${suffix}`),
    ),
    ['sales'],
  );
  const source = readFileSync(`app/api/sales/[id]/${suffix}/route.ts`, 'utf8');
  assert.match(source, /requireSession\(request\)/);
  assert.match(source, /assertPermission\(session, 'sales'\)/);
  assert.doesNotMatch(source, /function (POST|DELETE|PATCH)/);
}
const sale: SaleRecord = {
  id: 'sale',
  number: 1,
  customerId: null,
  customerName: 'Teste',
  sellerName: 'Teste',
  orderStatus: null,
  productsTotalCents: 10000,
  receivedTotalCents: 0,
  receivedDifferenceCents: -10000,
  referenceTotalCents: 10000,
  priceDifferenceCents: 0,
  status: 'completed',
  createdAt: 1790000000000,
  cancelledAt: null,
  cancelledByName: null,
  cancellationReason: null,
  items: [
    {
      id: 'item',
      productId: 'p',
      productName: 'iPhone',
      productDetail: '128 GB',
      serial: 'TESTSN',
      referencePriceCents: 10000,
      soldPriceCents: 10000,
      photos: [],
    },
  ],
  payments: [],
  receipts: [],
  reconciliation: deriveReceiptReconciliation([], 10000),
};
const saleBefore = JSON.stringify(sale);
const pending = salePendingItems(sale);
assert.ok(
  pending
    .find((item) => item.key === 'missing_receipt')
    ?.actions.some((action) => action.key === 'receipts'),
);
assert.ok(
  pending
    .find((item) => item.key === 'pending_payment')
    ?.reasons[0].includes('100,00'),
);
assert.ok(
  pending
    .find((item) => item.key === 'missing_photo')
    ?.reasons[0].includes('TESTSN'),
);
assert.equal(JSON.stringify(sale), saleBefore);
assert.deepEqual(salePendingItems({ ...sale, status: 'cancelled' }), []);
sale.payments = [
  {
    id: 'cash',
    method: 'cash',
    pixAccountId: null,
    accountName: null,
    amountCents: 10000,
  },
];
assert.deepEqual(
  salePendingItems(sale).map((item) => item.key),
  ['missing_photo'],
);
adapter.database.close();
console.log(
  'Sale activity and actionable issues passed: sanitized history, before/after, pagination, tenant isolation, same-sale/linked/historical duplicates, cancelled exclusions, permissions, no writes and cash-aware actions.',
);
