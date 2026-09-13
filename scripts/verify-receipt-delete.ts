import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import { deleteSaleReceipt } from '../lib/server/delete-receipt.ts';
import { processFileDeletions } from '../lib/server/file-deletion.ts';
import { deriveReceiptReconciliation } from '../lib/receipt-reconciliation.ts';

const db = new SqliteDatabase(':memory:');
db.database.exec(`
CREATE TABLE sales(id TEXT PRIMARY KEY, store_id TEXT, status TEXT, products_total_cents INTEGER,
  received_total_cents INTEGER, received_difference_cents INTEGER);
CREATE TABLE payments(id TEXT PRIMARY KEY, store_id TEXT, sale_id TEXT, method TEXT, amount_cents INTEGER);
CREATE TABLE sale_receipt_payment_sync(sale_id TEXT PRIMARY KEY, store_id TEXT, request_id TEXT, status TEXT, updated_at INTEGER);
CREATE TABLE attachments(id TEXT PRIMARY KEY, store_id TEXT, sale_id TEXT REFERENCES sales(id), kind TEXT,
  r2_key TEXT, file_name TEXT, mime_type TEXT, size_bytes INTEGER, receipt_amount_cents INTEGER,
  receipt_amount_source TEXT, receipt_amount_confirmed_by TEXT, receipt_amount_confirmed_at INTEGER);
CREATE TABLE audit_events(id TEXT PRIMARY KEY, store_id TEXT, actor_user_id TEXT, action TEXT, entity_type TEXT,
  entity_id TEXT NOT NULL, details_json TEXT, created_at INTEGER);
ALTER TABLE attachments ADD receipt_details_json TEXT;
ALTER TABLE attachments ADD receipt_review_reason TEXT;
CREATE TABLE receipt_payment_links(attachment_id TEXT,store_id TEXT,sale_id TEXT,payment_id TEXT,transaction_id TEXT);
`);
for (const name of [
  '0009_durable_receipt_jobs',
  '0013_manual_receipt_deletion',
])
  db.database.exec(
    await readFile(new URL(`../drizzle/${name}.sql`, import.meta.url), 'utf8'),
  );
let deletedKeys: string[] = [];
const files = {
  delete: async (key: string) => {
    deletedKeys.push(key);
  },
};
const input = {
  operationId: 'op1',
  saleId: 'sale1',
  receiptId: 'r1',
  storeId: 'store1',
  actorId: 'owner1',
  subject: { role: 'owner' as const },
};
function seed() {
  db.database
    .exec(`DELETE FROM sale_receipt_payment_sync; DELETE FROM receipt_payment_links; DELETE FROM attachments; DELETE FROM sales; DELETE FROM payments; DELETE FROM audit_events; DELETE FROM file_deletion_jobs;
    INSERT INTO sales VALUES
      ('sale1','store1','completed',1500000,1850000,350000),
      ('sale2','store2','completed',10,10,0);
    INSERT INTO payments VALUES
      ('p1','store1','sale1','pix',500000),
      ('p2','store1','sale1','pix',1000000),
      ('p3','store1','sale1','cash',100000),
      ('p4','store1','sale1','pix',250000);
    INSERT INTO attachments(id,store_id,sale_id,kind,r2_key,file_name,mime_type,size_bytes,receipt_amount_cents,receipt_amount_source,receipt_amount_confirmed_by,receipt_amount_confirmed_at) VALUES
      ('r1','store1','sale1','receipt','private/r1','receipt1.png','image/png',4,500000,'ocr',NULL,1),
      ('r2','store1','sale1','receipt','private/r2','receipt2.png','image/png',4,1000000,'manual','owner1',2),
      ('photo','store1','sale1','item_photo','private/photo','photo.png','image/png',4,NULL,NULL,NULL,NULL),
      ('foreign','store2','sale2','receipt','private/foreign','foreign.png','image/png',4,10,'ocr',NULL,1);
    INSERT INTO receipt_payment_links VALUES
      ('r1','store1','sale1','p1','transaction-1'),
      ('r2','store1','sale1','p2','transaction-2');
    INSERT INTO receipt_ocr_jobs(attachment_id,status,next_attempt_at,created_at,updated_at) VALUES ('r1','processing',0,0,0);`);
  deletedKeys = [];
}
const one = (sql: string) => db.database.prepare(sql).get();
const assertTotals = (total: number, difference: number) => {
  const row = one(
    "SELECT received_total_cents AS total,received_difference_cents AS difference FROM sales WHERE id='sale1'",
  ) as { total: number; difference: number };
  assert.equal(row.total, total);
  assert.equal(row.difference, difference);
};
const run = (override = {}) =>
  deleteSaleReceipt(db as unknown as D1Database, files, {
    ...input,
    ...override,
  });
const assertError = (promise: Promise<unknown>, status: number) =>
  assert.rejects(
    promise,
    (error: unknown) => (error as { status: number }).status === status,
  );
seed();
const remainingPix = one("SELECT * FROM payments WHERE id='p2'");
const cash = one("SELECT * FROM payments WHERE id='p3'");
const legacyPix = one("SELECT * FROM payments WHERE id='p4'");
assert.equal((await run()).cleanupPending, false);
assert.equal(one("SELECT * FROM attachments WHERE id='r1'"), undefined);
assert.equal(
  one("SELECT * FROM receipt_ocr_jobs WHERE attachment_id='r1'"),
  undefined,
);
assert.ok(one("SELECT * FROM attachments WHERE id='photo'"));
assert.ok(one("SELECT * FROM attachments WHERE id='r2'"));
assert.equal(one("SELECT * FROM payments WHERE id='p1'"), undefined);
assert.equal(one("SELECT * FROM receipt_payment_links WHERE attachment_id='r1'"), undefined);
assert.deepEqual(one("SELECT * FROM payments WHERE id='p2'"), remainingPix);
assert.deepEqual(one("SELECT * FROM payments WHERE id='p3'"), cash);
assert.deepEqual(one("SELECT * FROM payments WHERE id='p4'"), legacyPix);
assertTotals(1100000, -400000);
assert.deepEqual(deletedKeys, ['private/r1']);
const details = JSON.parse(
  one("SELECT details_json FROM audit_events WHERE id='op1'")!
    .details_json as string,
);
assert.equal(details.before.amountCents, 500000);
assert.equal(details.before.name, 'receipt1.png');
assert.equal(details.before.paymentId, 'p1');
assert.equal(details.before.ownedPaymentId, 'p1');
assert.deepEqual(details.before.claimedPaymentIds, []);
assert.equal(details.after, null);
assert.equal(
  one("SELECT actor_user_id FROM audit_events WHERE id='op1'")!.actor_user_id,
  'owner1',
);
db.database.exec(
  "INSERT INTO sale_receipt_payment_sync VALUES('sale1','store1','new-receipt-sync','pending',777)",
);
const newReceiptSync = one(
  "SELECT * FROM sale_receipt_payment_sync WHERE sale_id='sale1'",
);
assert.equal((await run()).replayed, true);
assert.deepEqual(
  one("SELECT * FROM sale_receipt_payment_sync WHERE sale_id='sale1'"),
  newReceiptSync,
);
assert.equal(one('SELECT count(*) AS n FROM audit_events')!.n, 1);
assert.equal(
  deriveReceiptReconciliation([{ amountCents: 1000000 }], 1000000).status,
  'reconciled',
);
await run({ operationId: 'op2', receiptId: 'r2' });
assert.equal(
  one("SELECT status FROM sale_receipt_payment_sync WHERE sale_id='sale1'")!
    .status,
  'manual',
);
assert.equal(one("SELECT * FROM payments WHERE id='p2'"), undefined);
assert.ok(one("SELECT * FROM payments WHERE id='p3'"));
assert.ok(one("SELECT * FROM payments WHERE id='p4'"));
assertTotals(100000, -1400000);
assert.equal(deriveReceiptReconciliation([], 0).status, 'not_required');

// Historical allocation claims may associate existing/manual Pix with every
// receipt. They are evidence, not ownership, so none of those payments may be
// deleted merely because the last claimed receipt is removed.
seed();
db.database.exec(`
  DELETE FROM receipt_payment_links;
  DELETE FROM payments;
  INSERT INTO payments VALUES
    ('h-only','store1','sale1','pix',500000),
    ('h-shared','store1','sale1','pix',700000),
    ('h-cash','store1','sale1','cash',100000),
    ('h-legacy','store1','sale1','pix',250000);
  UPDATE sales SET received_total_cents=1550000,received_difference_cents=50000 WHERE id='sale1';
  INSERT INTO audit_events VALUES
    ('claim-r1','store1','owner1','sale.receipt_transaction_claimed','attachment','r1',
      '{"transactionId":"E1111111111111111111111111111111","saleId":"sale1","paymentIds":["h-only","h-shared","h-cash"]}',1),
    ('claim-r2','store1','owner1','sale.receipt_transaction_claimed','attachment','r2',
      '{"transactionId":"E2222222222222222222222222222222","saleId":"sale1","paymentIds":["h-shared"]}',2),
    ('claim-malformed','store1','owner1','sale.receipt_transaction_claimed','attachment','r1','not-json',3),
    ('claim-scalar','store1','owner1','sale.receipt_transaction_claimed','attachment','r1',
      '{"saleId":"sale1","paymentIds":"h-legacy"}',4),
    ('claim-foreign','store2','owner1','sale.receipt_transaction_claimed','attachment','r1',
      '{"saleId":"sale1","paymentIds":["foreign-pix"]}',5);
`);
assert.equal((await run()).replayed, false);
assert.ok(one("SELECT * FROM payments WHERE id='h-only'"));
assert.ok(one("SELECT * FROM payments WHERE id='h-shared'"));
assert.ok(one("SELECT * FROM payments WHERE id='h-cash'"));
assert.ok(one("SELECT * FROM payments WHERE id='h-legacy'"));
assertTotals(1100000, -400000);
const historicalDelete = JSON.parse(
  one("SELECT details_json FROM audit_events WHERE id='op1'")!
    .details_json as string,
);
assert.deepEqual(historicalDelete.before.claimedPaymentIds, [
  'h-cash',
  'h-only',
  'h-shared',
]);
await run({ operationId: 'op2', receiptId: 'r2' });
assert.ok(one("SELECT * FROM payments WHERE id='h-only'"));
assert.ok(one("SELECT * FROM payments WHERE id='h-shared'"));
assert.ok(one("SELECT * FROM payments WHERE id='h-cash'"));
assert.ok(one("SELECT * FROM payments WHERE id='h-legacy'"));
assertTotals(100000, -1400000);

// An old replay without direct ownership evidence preserves the Pix, while
// still repairing stale cached totals through cash + accepted receipts.
seed();
db.database.exec(`
  DELETE FROM receipt_payment_links WHERE attachment_id='r1';
  DELETE FROM receipt_ocr_jobs WHERE attachment_id='r1';
  DELETE FROM attachments WHERE id='r1';
  INSERT INTO audit_events VALUES(
    'op1','store1','owner1','sale.receipt_deleted','sale','sale1',
    '{"fingerprint":"{\\"saleId\\":\\"sale1\\",\\"receiptId\\":\\"r1\\"}","receiptId":"r1","before":{"paymentId":"p1"},"after":null}',1);
  UPDATE sales SET received_total_cents=1850000,received_difference_cents=350000 WHERE id='sale1';
`);
assert.equal((await run()).replayed, true);
assert.ok(one("SELECT * FROM payments WHERE id='p1'"));
assert.ok(one("SELECT * FROM payments WHERE id='p2'"));
assert.ok(one("SELECT * FROM payments WHERE id='p3'"));
assert.ok(one("SELECT * FROM payments WHERE id='p4'"));
assertTotals(1100000, -400000);
db.database.exec(
  "UPDATE sales SET received_total_cents=999,received_difference_cents=999 WHERE id='sale1'",
);
assert.equal((await run()).replayed, true);
assertTotals(1100000, -400000);

// The per-receipt automatic flow also left a strong sale.payment_added event.
// It safely recovers ownership on replay even when the old link is already gone.
seed();
db.database.exec(`
  DELETE FROM receipt_payment_links WHERE attachment_id='r1';
  DELETE FROM receipt_ocr_jobs WHERE attachment_id='r1';
  DELETE FROM attachments WHERE id='r1';
  INSERT INTO audit_events VALUES
    ('p1','store1','owner1','sale.payment_added','sale','sale1',
      '{"paymentId":"p1","method":"pix","amountCents":500000,"attachmentId":"r1"}',1),
    ('op1','store1','owner1','sale.receipt_deleted','sale','sale1',
      '{"fingerprint":"{\\"saleId\\":\\"sale1\\",\\"receiptId\\":\\"r1\\"}","receiptId":"r1","before":{},"after":null}',2);
  UPDATE sales SET received_total_cents=1850000,received_difference_cents=350000 WHERE id='sale1';
`);
assert.equal((await run()).replayed, true);
assert.equal(one("SELECT * FROM payments WHERE id='p1'"), undefined);
assert.ok(one("SELECT * FROM payments WHERE id='p2'"));
assert.ok(one("SELECT * FROM payments WHERE id='p3'"));
assert.ok(one("SELECT * FROM payments WHERE id='p4'"));
assertTotals(1100000, -400000);

// Claims are neither ownership nor protection: a direct per-receipt link still
// owns its Pix even if an old all-to-all allocation mentioned it elsewhere.
seed();
db.database.exec(`INSERT INTO audit_events VALUES(
  'claim-shared','store1','owner1','sale.receipt_transaction_claimed','attachment','r2',
  '{"transactionId":"E3333333333333333333333333333333","saleId":"sale1","paymentIds":["p1"]}',1)`);
await run();
assert.equal(one("SELECT * FROM payments WHERE id='p1'"), undefined);
assertTotals(1100000, -400000);

// If an anomalous historical database has two direct links to one payment,
// deleting either receipt cannot delete the payment while the other link lives.
seed();
db.database.exec(`
  DELETE FROM receipt_payment_links WHERE attachment_id='r2';
  INSERT INTO receipt_payment_links VALUES('r2','store1','sale1','p1','transaction-shared');
`);
await run();
assert.ok(one("SELECT * FROM payments WHERE id='p1'"));
assert.ok(one("SELECT * FROM receipt_payment_links WHERE attachment_id='r2' AND payment_id='p1'"));
assertTotals(1100000, -400000);

await assertError(run({ receiptId: 'foreign' }), 409);
await assertError(run({ actorId: 'other' }), 409);
seed();
await assertError(run({ storeId: 'store2' }), 404);
await assertError(run({ receiptId: 'foreign' }), 404);
await assertError(run({ receiptId: 'photo' }), 404);
await assertError(run({ subject: { role: 'operator' } }), 403);
db.database.exec("UPDATE sales SET status='cancelled' WHERE id='sale1'");
await assertError(run(), 409);
assert.equal(one('SELECT count(*) AS n FROM audit_events')!.n, 0);
assert.deepEqual(deletedKeys, []);
seed();
const concurrent = await Promise.allSettled([
  run(),
  run({ operationId: 'other-op' }),
]);
assert.equal(concurrent.filter((row) => row.status === 'fulfilled').length, 1);
assert.equal(one('SELECT count(*) AS n FROM audit_events')!.n, 1);

// If another operation removes the target after assertTarget but before this
// batch begins, the losing operation must not cancel a newer receipt sync.
seed();
const batchBeforeRace = db.batch.bind(db);
let injectedConcurrentDelete = false;
db.batch = async (statements) => {
  if (!injectedConcurrentDelete) {
    injectedConcurrentDelete = true;
    db.database.exec(`
      DELETE FROM attachments WHERE id='r1';
      INSERT INTO sale_receipt_payment_sync VALUES('sale1','store1','new-after-concurrent-delete','pending',888);
    `);
  }
  return batchBeforeRace(statements);
};
try {
  await assertError(run({ operationId: 'losing-op' }), 404);
} finally {
  db.batch = batchBeforeRace;
}
assert.equal(
  one("SELECT count(*) AS n FROM audit_events WHERE id='losing-op'")!.n,
  0,
);
const preservedConcurrentSync = one(
  "SELECT * FROM sale_receipt_payment_sync WHERE sale_id='sale1'",
) as Record<string, unknown>;
assert.equal(preservedConcurrentSync.sale_id, 'sale1');
assert.equal(preservedConcurrentSync.store_id, 'store1');
assert.equal(
  preservedConcurrentSync.request_id,
  'new-after-concurrent-delete',
);
assert.equal(preservedConcurrentSync.status, 'pending');
assert.equal(preservedConcurrentSync.updated_at, 888);
seed();
const replays = await Promise.all([run(), run()]);
assert.ok(replays.every((row) => row.ok));
assert.equal(one('SELECT count(*) AS n FROM audit_events')!.n, 1);
seed();
// A failed transaction must neither delete the object nor leave partial audit.
const beforeRollbackPayment = one("SELECT * FROM payments WHERE id='p1'");
const beforeRollbackLink = one("SELECT * FROM receipt_payment_links WHERE attachment_id='r1'");
const beforeRollbackTotal = one("SELECT * FROM sales WHERE id='sale1'");
db.database.exec(
  "CREATE TRIGGER block_delete BEFORE DELETE ON attachments BEGIN SELECT RAISE(ABORT, 'test rollback'); END;",
);
await assert.rejects(run(), /test rollback/);
assert.ok(one("SELECT * FROM attachments WHERE id='r1'"));
assert.deepEqual(one("SELECT * FROM payments WHERE id='p1'"), beforeRollbackPayment);
assert.deepEqual(one("SELECT * FROM receipt_payment_links WHERE attachment_id='r1'"), beforeRollbackLink);
assert.deepEqual(one("SELECT * FROM sales WHERE id='sale1'"), beforeRollbackTotal);
assert.equal(one('SELECT count(*) AS n FROM audit_events')!.n, 0);
assert.equal(one('SELECT count(*) AS n FROM file_deletion_jobs')!.n, 0);
assert.deepEqual(deletedKeys, []);
db.database.exec('DROP TRIGGER block_delete');
seed();
// Durable retry survives both request and worker failure without resurrecting metadata.
const brokenFiles = {
  delete: async () => {
    throw new Error('storage unavailable');
  },
};
assert.equal(
  (await deleteSaleReceipt(db as unknown as D1Database, brokenFiles, input))
    .cleanupPending,
  true,
);
assert.equal(one("SELECT * FROM attachments WHERE id='r1'"), undefined);
assert.equal(one('SELECT count(*) AS n FROM file_deletion_jobs')!.n, 1);
await processFileDeletions(
  db as unknown as D1Database,
  brokenFiles,
  Date.now() + 120000,
);
assert.equal(one('SELECT count(*) AS n FROM file_deletion_jobs')!.n, 1);
await processFileDeletions(
  db as unknown as D1Database,
  files,
  Date.now() + 240000,
);
assert.equal(one('SELECT count(*) AS n FROM file_deletion_jobs')!.n, 0);
assert.deepEqual(deletedKeys, ['private/r1']);
assert.equal((await run()).replayed, true);
seed();
// A lost response after COMMIT is resolved through the operation audit.
const batch = db.batch.bind(db);
db.batch = async (statements) => {
  await batch(statements);
  throw new Error('response lost after commit');
};
assert.equal((await run()).ok, true);
db.batch = batch;
assert.equal(one('SELECT count(*) AS n FROM audit_events')!.n, 1);
db.close();
console.log(
  'PASS: manual deletion, permissions, tenant/receipt scoping, cancellation, audit, transaction rollback, financial invariants, replay, concurrency, durable file cleanup and uncertain commit.',
);
