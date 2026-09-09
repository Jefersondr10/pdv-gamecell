import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import { deleteSaleReceipt } from '../lib/server/delete-receipt.ts';
import { processFileDeletions } from '../lib/server/file-deletion.ts';
import { deriveReceiptReconciliation } from '../lib/receipt-reconciliation.ts';

const db = new SqliteDatabase(':memory:');
db.database.exec(`
CREATE TABLE sales(id TEXT PRIMARY KEY, store_id TEXT, status TEXT, products_total_cents INTEGER);
CREATE TABLE payments(id TEXT PRIMARY KEY, sale_id TEXT, amount_cents INTEGER);
CREATE TABLE attachments(id TEXT PRIMARY KEY, store_id TEXT, sale_id TEXT REFERENCES sales(id), kind TEXT,
  r2_key TEXT, file_name TEXT, mime_type TEXT, size_bytes INTEGER, receipt_amount_cents INTEGER,
  receipt_amount_source TEXT, receipt_amount_confirmed_by TEXT, receipt_amount_confirmed_at INTEGER);
CREATE TABLE audit_events(id TEXT PRIMARY KEY, store_id TEXT, actor_user_id TEXT, action TEXT, entity_type TEXT,
  entity_id TEXT NOT NULL, details_json TEXT, created_at INTEGER);
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
    .exec(`DELETE FROM attachments; DELETE FROM sales; DELETE FROM payments; DELETE FROM audit_events; DELETE FROM file_deletion_jobs;
    INSERT INTO sales VALUES ('sale1','store1','completed',1500000), ('sale2','store2','completed',10);
    INSERT INTO payments VALUES ('p1','sale1',1500000);
    INSERT INTO attachments VALUES
      ('r1','store1','sale1','receipt','private/r1','receipt1.png','image/png',4,500000,'ocr',NULL,1),
      ('r2','store1','sale1','receipt','private/r2','receipt2.png','image/png',4,1000000,'manual','owner1',2),
      ('photo','store1','sale1','item_photo','private/photo','photo.png','image/png',4,NULL,NULL,NULL,NULL),
      ('foreign','store2','sale2','receipt','private/foreign','foreign.png','image/png',4,10,'ocr',NULL,1);
    INSERT INTO receipt_ocr_jobs(attachment_id,status,next_attempt_at,created_at,updated_at) VALUES ('r1','processing',0,0,0);`);
  deletedKeys = [];
}
const one = (sql: string) => db.database.prepare(sql).get();
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
const money = one("SELECT * FROM payments WHERE id='p1'");
const sale = one("SELECT * FROM sales WHERE id='sale1'");
assert.equal((await run()).cleanupPending, false);
assert.equal(one("SELECT * FROM attachments WHERE id='r1'"), undefined);
assert.equal(
  one("SELECT * FROM receipt_ocr_jobs WHERE attachment_id='r1'"),
  undefined,
);
assert.ok(one("SELECT * FROM attachments WHERE id='photo'"));
assert.ok(one("SELECT * FROM attachments WHERE id='r2'"));
assert.deepEqual(one("SELECT * FROM payments WHERE id='p1'"), money);
assert.deepEqual(one("SELECT * FROM sales WHERE id='sale1'"), sale);
assert.deepEqual(deletedKeys, ['private/r1']);
const details = JSON.parse(
  one("SELECT details_json FROM audit_events WHERE id='op1'")!
    .details_json as string,
);
assert.equal(details.before.amountCents, 500000);
assert.equal(details.before.name, 'receipt1.png');
assert.equal(details.after, null);
assert.equal(
  one("SELECT actor_user_id FROM audit_events WHERE id='op1'")!.actor_user_id,
  'owner1',
);
assert.equal((await run()).replayed, true);
assert.equal(one('SELECT count(*) AS n FROM audit_events')!.n, 1);
assert.equal(
  deriveReceiptReconciliation([{ amountCents: 1000000 }], 1500000)
    .differenceCents,
  -500000,
);
await run({ operationId: 'op2', receiptId: 'r2' });
assert.equal(deriveReceiptReconciliation([], 1500000).status, 'pending');
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
seed();
const replays = await Promise.all([run(), run()]);
assert.ok(replays.every((row) => row.ok));
assert.equal(one('SELECT count(*) AS n FROM audit_events')!.n, 1);
seed();
// A failed transaction must neither delete the object nor leave partial audit.
db.database.exec(
  "CREATE TRIGGER block_delete BEFORE DELETE ON attachments BEGIN SELECT RAISE(ABORT, 'test rollback'); END;",
);
await assert.rejects(run(), /test rollback/);
assert.ok(one("SELECT * FROM attachments WHERE id='r1'"));
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
