import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import { processReceiptJob } from '../lib/server/node/receipt-jobs.mjs';

const db = new SqliteDatabase(':memory:');
db.database.exec(
  `CREATE TABLE sales(id TEXT PRIMARY KEY, store_id TEXT, status TEXT); CREATE TABLE attachments(id TEXT PRIMARY KEY, store_id TEXT, sale_id TEXT REFERENCES sales(id), kind TEXT, r2_key TEXT, mime_type TEXT, size_bytes INTEGER, receipt_amount_cents INTEGER, receipt_amount_source TEXT, receipt_amount_confirmed_by TEXT, receipt_amount_confirmed_at INTEGER);`,
);
db.database.exec(
  await readFile(
    new URL('../drizzle/0009_durable_receipt_jobs.sql', import.meta.url),
    'utf8',
  ),
);
let now = 1_000_000;
const clock = () => now;
let calls = 0;
let mode = 'ok';
let release;
globalThis.fetch = async () => {
  calls++;
  if (mode === 'hold')
    await new Promise((resolve) => {
      release = resolve;
    });
  if (mode === 'unavailable') return new Response(null, { status: 503 });
  return Response.json({
    amountCents: mode === 'missing' ? null : 284000,
    confidence: 'high',
  });
};
const files = { get: async () => ({ body: new Blob(['test']).stream() }) };
const seed = () => {
  db.database.exec('DELETE FROM attachments; DELETE FROM sales;');
  db.database
    .prepare('INSERT INTO sales VALUES (?, ?, ?)')
    .run('sale', 'store', 'completed');
  db.database
    .prepare(
      'INSERT INTO attachments(id,store_id,sale_id,kind,r2_key,mime_type,size_bytes) VALUES (?,?,?,?,?,?,?)',
    )
    .run(
      'receipt',
      'store',
      'sale',
      'receipt',
      'private-test-file',
      'image/png',
      4,
    );
};
const job = () => db.database.prepare('SELECT * FROM receipt_ocr_jobs').get();
const amount = () =>
  db.database
    .prepare(
      'SELECT receipt_amount_cents AS amount, receipt_amount_source AS source FROM attachments',
    )
    .get();

seed();
mode = 'hold';
const first = processReceiptJob(db, files, 'http://isolated.test', clock);
while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
assert.equal(
  await processReceiptJob(db, files, 'http://isolated.test', clock),
  false,
);
assert.equal(calls, 1);
release();
await first;
assert.equal(job().status, 'done');
assert.equal(amount().amount, 284000);
assert.equal(
  await processReceiptJob(db, files, 'http://isolated.test', clock),
  false,
);

seed();
mode = 'ok';
db.database
  .prepare(
    "INSERT INTO receipt_ocr_jobs(attachment_id,status,attempts,generation,lease_token,lease_until,next_attempt_at,created_at,updated_at) VALUES('receipt','processing',1,1,'dead-worker',?,?,?,?)",
  )
  .run(now - 1, now - 200_000, now - 200_000, now - 200_000);
await processReceiptJob(db, files, 'http://isolated.test', clock);
assert.equal(job().status, 'done');
assert.equal(job().attempts, 2);

for (const override of ['manual', 'cancel']) {
  seed();
  mode = 'hold';
  release = null;
  const running = processReceiptJob(db, files, 'http://isolated.test', clock);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  if (override === 'manual') {
    db.database.exec(
      "UPDATE attachments SET receipt_amount_cents=12345, receipt_amount_source='manual'; UPDATE receipt_ocr_jobs SET generation=generation+1,status='cancelled',lease_token=NULL;",
    );
  } else db.database.exec("UPDATE sales SET status='cancelled'");
  release();
  await running;
  assert.equal(amount().amount, override === 'manual' ? 12345 : null);
  assert.equal(job().status, 'cancelled');
}
seed();
mode = 'unavailable';
for (let attempt = 1; attempt <= 5; attempt++) {
  await processReceiptJob(db, files, 'http://isolated.test', clock);
  assert.equal(job().attempts, attempt);
  assert.equal(job().status, attempt === 5 ? 'needs_review' : 'retry');
  now += 4_000_000;
}
seed();
mode = 'missing';
await processReceiptJob(db, files, 'http://isolated.test', clock);
assert.equal(job().status, 'needs_review');
assert.equal(amount().amount, null);
seed();
mode = 'ok';
await processReceiptJob(
  db,
  { get: async () => null },
  'http://isolated.test',
  clock,
);
assert.equal(job().error_code, 'FILE_MISSING');
seed();
await processReceiptJob(
  db,
  { get: async () => ({ body: new Blob(['larger-than-metadata']).stream() }) },
  'http://isolated.test',
  clock,
);
assert.equal(job().error_code, 'FILE_INVALID');
db.close();
console.log(
  'PASS: single claim, expired lease/restart, manual priority, cancelled sale, durable bounded retries, missing/unreadable files and bounded stream size.',
);
