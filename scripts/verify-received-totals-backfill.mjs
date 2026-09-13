import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = await mkdtemp(join(tmpdir(), 'pdv-received-backfill-test-'));
const databasePath = join(directory, 'pdv.sqlite');
const maintenanceScript = resolve(
  'scripts/hostinger/reconcile-received-totals.mjs',
);
const sourceCommit = '0123456789abcdef0123456789abcdef01234567';
let db;
let snapshot;

function fileDigest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function queryDigest(db, sql) {
  const hash = createHash('sha256');
  let count = 0;
  for (const row of db.prepare(sql).iterate()) {
    hash.update(JSON.stringify(row));
    hash.update('\n');
    count += 1;
  }
  return { count, hash: hash.digest('hex') };
}

const protectedTables = [
  'payments',
  'attachments',
  'receipt_payment_links',
  'inventory_units',
  'sale_items',
  'receipt_ocr_jobs',
  'sale_receipt_payment_sync',
  'file_deletion_jobs',
];

function protectedState(db) {
  return Object.fromEntries(
    protectedTables.map((table) => [
      table,
      queryDigest(db, `SELECT * FROM "${table}" ORDER BY rowid`),
    ]),
  );
}

function saleCache(db, saleId) {
  return {
    ...db
      .prepare(
        'SELECT received_total_cents AS received, received_difference_cents AS difference FROM sales WHERE id=?',
      )
      .get(saleId),
  };
}

function runMaintenance(...args) {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-transform-types',
      maintenanceScript,
      databasePath,
      ...args,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      windowsHide: true,
    },
  );
  const lines = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const jsonLine = [...lines]
    .reverse()
    .find((line) => line.startsWith('{') && line.endsWith('}'));
  return {
    ...result,
    output: jsonLine ? JSON.parse(jsonLine) : null,
  };
}

async function backupFiles() {
  try {
    return (await readdir(join(directory, 'backups')))
      .filter((name) => name.endsWith('.sqlite'))
      .sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

try {
  db = new DatabaseSync(databasePath);
  for (const migration of (await readdir('drizzle'))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort())
    db.exec(await readFile(join('drizzle', migration), 'utf8'));
  db.exec('PRAGMA foreign_keys=ON;');

  const now = 1_789_300_000_000;
  const storeId = '10000000-0000-4000-8000-000000000001';
  const userId = '20000000-0000-4000-8000-000000000001';
  const productId = '30000000-0000-4000-8000-000000000001';
  const entryId = '40000000-0000-4000-8000-000000000001';
  const unitId = '50000000-0000-4000-8000-000000000001';
  const saleId = '60000000-0000-4000-8000-000000000001';
  const saleItemId = '70000000-0000-4000-8000-000000000001';
  const cashPaymentId = '80000000-0000-4000-8000-000000000001';
  const pixPaymentId = '80000000-0000-4000-8000-000000000002';
  const receiptId = '90000000-0000-4000-8000-000000000001';

  db.prepare(
    `INSERT INTO stores
      (id,name,code,next_sale_number,created_at,updated_at)
     VALUES(?,?,?,?,?,?)`,
  ).run(storeId, 'Loja sintética', 'SYNTH', 2, now, now);
  db.prepare(
    `INSERT INTO users
      (id,store_id,role,auth_kind,display_name,active,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run(userId, storeId, 'owner', 'password', 'Usuário sintético', 1, now, now);
  db.prepare(
    `INSERT INTO products
      (id,store_id,model,color,memory,default_price_cents,active,created_by,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    productId,
    storeId,
    'Aparelho sintético',
    'Preto',
    '256 GB',
    7000,
    1,
    userId,
    now,
    now,
  );
  db.prepare(
    `INSERT INTO entries
      (id,store_id,product_id,operator_user_id,quantity,note,created_at)
     VALUES(?,?,?,?,?,?,?)`,
  ).run(entryId, storeId, productId, userId, 1, 'Entrada sintética', now);
  db.prepare(
    `INSERT INTO inventory_units
      (id,store_id,product_id,entry_id,serial,status,sale_id,created_at,sold_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  ).run(
    unitId,
    storeId,
    productId,
    entryId,
    'SYNTHETIC-SERIAL-001',
    'available',
    null,
    now,
    null,
  );
  db.prepare(
    `INSERT INTO sales
      (id,store_id,number,customer_name,seller_user_id,seller_name,
       products_total_cents,received_total_cents,received_difference_cents,
       reference_total_cents,price_difference_cents,status,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    saleId,
    storeId,
    1,
    'Cliente sintético',
    userId,
    'Operador sintético',
    7000,
    12000,
    5000,
    7000,
    0,
    'completed',
    now,
  );
  db.prepare(
    "UPDATE inventory_units SET status='sold', sale_id=?, sold_at=? WHERE id=?",
  ).run(saleId, now, unitId);
  db.prepare(
    `INSERT INTO sale_items
      (id,store_id,sale_id,inventory_unit_id,product_id,product_name,
       product_detail,serial,reference_price_cents,sold_price_cents,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    saleItemId,
    storeId,
    saleId,
    unitId,
    productId,
    'Aparelho sintético',
    'Preto · 256 GB',
    'SYNTHETIC-SERIAL-001',
    7000,
    7000,
    now,
  );
  db.prepare(
    `INSERT INTO payments
      (id,store_id,sale_id,method,pix_account_id,account_name,amount_cents,created_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run(cashPaymentId, storeId, saleId, 'cash', null, null, 2000, now);
  db.prepare(
    `INSERT INTO payments
      (id,store_id,sale_id,method,pix_account_id,account_name,amount_cents,created_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run(
    pixPaymentId,
    storeId,
    saleId,
    'pix',
    null,
    'Conta legada sintética',
    5000,
    now,
  );
  db.prepare(
    `INSERT INTO attachments
      (id,store_id,kind,sale_id,r2_key,file_name,mime_type,size_bytes,
       receipt_amount_cents,receipt_amount_source,created_by,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    receiptId,
    storeId,
    'receipt',
    saleId,
    'synthetic/receipt-one',
    'synthetic-receipt.png',
    'image/png',
    128,
    5000,
    'ocr',
    userId,
    now,
  );
  db.prepare(
    `INSERT INTO receipt_payment_links
      (attachment_id,store_id,sale_id,payment_id,transaction_id,created_at)
     VALUES(?,?,?,?,?,?)`,
  ).run(
    receiptId,
    storeId,
    saleId,
    pixPaymentId,
    'SYNTHETIC-TRANSACTION-001',
    now,
  );
  db.prepare(
    `INSERT INTO receipt_ocr_jobs
      (attachment_id,status,attempts,generation,reader_revision,next_attempt_at,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run(receiptId, 'done', 1, 1, 1, now, now, now);
  db.prepare(
    `INSERT INTO sale_receipt_payment_sync
      (sale_id,store_id,request_id,requested_by,target_payment_id,status,updated_at)
     VALUES(?,?,?,?,?,?,?)`,
  ).run(
    saleId,
    storeId,
    'synthetic:applied',
    userId,
    pixPaymentId,
    'applied',
    now,
  );
  db.prepare(
    `INSERT INTO file_deletion_jobs
      (operation_id,r2_key,attempts,next_attempt_at,created_at)
     VALUES(?,?,?,?,?)`,
  ).run(
    'synthetic-file-job',
    'synthetic/unrelated-object',
    0,
    now + 100_000,
    now,
  );
  db.prepare(
    `INSERT INTO audit_events
      (id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run(
    'a0000000-0000-4000-8000-000000000001',
    storeId,
    userId,
    'test.synthetic_seeded',
    'sale',
    saleId,
    JSON.stringify({ synthetic: true }),
    now,
  );
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  const protectedBefore = protectedState(db);
  const auditCountBefore = db
    .prepare('SELECT COUNT(*) AS count FROM audit_events')
    .get().count;
  db.close();

  const databaseFileBeforeDryRun = fileDigest(await readFile(databasePath));
  const dryRun = runMaintenance();
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.deepEqual(
    {
      mode: dryRun.output.mode,
      mismatchedSales: dryRun.output.mismatchedSales,
      requiresApply: dryRun.output.requiresApply,
      pendingOcrJobs: dryRun.output.pendingOcrJobs,
      pendingReceiptSyncs: dryRun.output.pendingReceiptSyncs,
    },
    {
      mode: 'dry-run',
      mismatchedSales: 1,
      requiresApply: true,
      pendingOcrJobs: 0,
      pendingReceiptSyncs: 0,
    },
  );
  assert.equal(
    fileDigest(await readFile(databasePath)),
    databaseFileBeforeDryRun,
    'dry-run must not mutate the SQLite file',
  );
  assert.deepEqual(await backupFiles(), []);

  db = new DatabaseSync(databasePath, { readOnly: true });
  assert.deepEqual(protectedState(db), protectedBefore);
  assert.deepEqual(saleCache(db, saleId), {
    received: 12000,
    difference: 5000,
  });
  db.close();

  const applyArguments = [
    '--apply',
    '--run-id',
    'synthetic-backfill-v1',
    '--commit',
    sourceCommit,
  ];
  const applied = runMaintenance(...applyArguments);
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(
    {
      repairedSales: applied.output.repairedSales,
      auditEventsAdded: applied.output.auditEventsAdded,
      remainingMismatches: applied.output.remainingMismatches,
      backupCreated: applied.output.backupCreated,
      protectedDataVerified: applied.output.protectedDataVerified,
    },
    {
      repairedSales: 1,
      auditEventsAdded: 1,
      remainingMismatches: 0,
      backupCreated: true,
      protectedDataVerified: true,
    },
  );

  const backupsAfterApply = await backupFiles();
  assert.equal(backupsAfterApply.length, 1);
  assert.equal(applied.output.backupFile, backupsAfterApply[0]);
  snapshot = new DatabaseSync(
    join(directory, 'backups', backupsAfterApply[0]),
    { readOnly: true },
  );
  assert.deepEqual(
    saleCache(snapshot, saleId),
    { received: 12000, difference: 5000 },
    'backup must retain the pre-repair cache',
  );
  assert.equal(snapshot.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  assert.equal(snapshot.prepare('PRAGMA foreign_key_check').all().length, 0);
  snapshot.close();
  snapshot = null;

  db = new DatabaseSync(databasePath, { readOnly: true });
  assert.deepEqual(saleCache(db, saleId), { received: 7000, difference: 0 });
  assert.deepEqual(protectedState(db), protectedBefore);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count,
    auditCountBefore + 1,
  );
  const audit = db
    .prepare(
      "SELECT details_json AS details FROM audit_events WHERE action='maintenance.sale_received_totals_reconciled' AND entity_id=?",
    )
    .get(saleId);
  const auditDetails = JSON.parse(audit.details);
  assert.equal(auditDetails.ruleVersion, 'cash-plus-accepted-receipts-v1');
  assert.deepEqual(auditDetails.before, {
    receivedTotalCents: 12000,
    receivedDifferenceCents: 5000,
  });
  assert.deepEqual(auditDetails.after, {
    receivedTotalCents: 7000,
    receivedDifferenceCents: 0,
  });
  assert.equal(auditDetails.evidence.cashTotalCents, 2000);
  assert.equal(auditDetails.evidence.acceptedReceiptTotalCents, 5000);
  assert.equal(auditDetails.evidence.legacyPixTotalCentsIgnored, 5000);
  assert.deepEqual(auditDetails.evidence.acceptedReceiptIds, [receiptId]);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  db.close();

  const repeated = runMaintenance(...applyArguments);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(repeated.output.repairedSales, 0);
  assert.equal(repeated.output.auditEventsAdded, 0);
  assert.equal(repeated.output.backupCreated, false);
  assert.deepEqual(await backupFiles(), backupsAfterApply);
  db = new DatabaseSync(databasePath);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count,
    auditCountBefore + 1,
  );
  assert.deepEqual(protectedState(db), protectedBefore);

  db.prepare(
    'UPDATE sales SET received_total_cents=?, received_difference_cents=? WHERE id=?',
  ).run(9999, 2999, saleId);
  db.prepare(
    "UPDATE receipt_ocr_jobs SET status='pending' WHERE attachment_id=?",
  ).run(receiptId);
  const protectedBeforePendingAttempt = protectedState(db);
  const auditCountBeforePendingAttempt = db
    .prepare('SELECT COUNT(*) AS count FROM audit_events')
    .get().count;
  db.close();

  const rejected = runMaintenance(
    '--apply',
    '--run-id',
    'synthetic-pending-rejection',
    '--commit',
    sourceCommit,
  );
  assert.notEqual(rejected.status, 0);
  assert.equal(rejected.output.ok, false);
  assert.match(rejected.output.error, /processing is still active/i);
  assert.deepEqual(await backupFiles(), backupsAfterApply);
  db = new DatabaseSync(databasePath, { readOnly: true });
  assert.deepEqual(protectedState(db), protectedBeforePendingAttempt);
  assert.deepEqual(saleCache(db, saleId), { received: 9999, difference: 2999 });
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count,
    auditCountBeforePendingAttempt,
  );
  db.close();

  console.log(
    'PASS: received-total backfill dry-run, verified backup, audited repair, protected records, idempotence and pending-queue rejection.',
  );
} finally {
  try {
    snapshot?.close();
  } catch {}
  try {
    db?.close();
  } catch {}
  await rm(directory, { recursive: true, force: true });
}
