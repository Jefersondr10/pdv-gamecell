import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import {
  requestReceiptPaymentSync,
  settleReceiptPaymentSync,
  stopReceiptPaymentSync,
  processReceiptPaymentSync,
  readReceiptPaymentSync,
} from '../lib/server/receipt-payment-sync.ts';
import { SALE_RECEIVED_TOTAL_SQL } from '../lib/server/sale-status-sql.ts';

const db = new SqliteDatabase(':memory:');
db.database.exec(`
CREATE TABLE stores(id TEXT PRIMARY KEY);
CREATE TABLE pix_accounts(id TEXT PRIMARY KEY,store_id TEXT,name TEXT,active INTEGER,receipt_bank TEXT,receipt_recipient_document TEXT);
CREATE TABLE users(id TEXT PRIMARY KEY,store_id TEXT,role TEXT,permissions_json TEXT,active INTEGER);
CREATE TABLE sales(id TEXT PRIMARY KEY,store_id TEXT,status TEXT,products_total_cents INTEGER,received_total_cents INTEGER,received_difference_cents INTEGER);
CREATE TABLE payments(id TEXT PRIMARY KEY,store_id TEXT,sale_id TEXT,method TEXT,pix_account_id TEXT,account_name TEXT,amount_cents INTEGER,created_at INTEGER);
CREATE TABLE attachments(id TEXT PRIMARY KEY,store_id TEXT,sale_id TEXT,kind TEXT,receipt_amount_cents INTEGER,receipt_amount_source TEXT,receipt_amount_confirmed_at INTEGER,receipt_details_json TEXT,receipt_review_reason TEXT);
CREATE TABLE receipt_payment_links(attachment_id TEXT PRIMARY KEY,store_id TEXT,sale_id TEXT,payment_id TEXT,transaction_id TEXT,created_at INTEGER);
CREATE TABLE receipt_ocr_jobs(attachment_id TEXT PRIMARY KEY,status TEXT);
CREATE TABLE audit_events(id TEXT PRIMARY KEY,store_id TEXT,actor_user_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT NOT NULL,details_json TEXT,created_at INTEGER);
INSERT INTO stores VALUES('store'),('other');
INSERT INTO users VALUES('owner','store','owner',NULL,1),('staff','store','operator','["sales","sales.payments"]',1);`);
db.database.exec(
  await readFile(
    new URL('../drizzle/0014_receipt_payment_sync.sql', import.meta.url),
    'utf8',
  ),
);
const database = db as unknown as D1Database;
const scope = {
  storeId: 'store',
  saleId: 'sale',
  actorId: 'owner',
  subject: { role: 'owner' as const },
};
const get = (sql: string) => db.database.prepare(sql).get()!;
const received = () =>
  Number(
    get(
      `SELECT ${SALE_RECEIVED_TOTAL_SQL} AS n FROM sales s WHERE id='sale'`,
    ).n,
  );
function seed() {
  db.database
    .exec(`DELETE FROM sale_receipt_payment_sync; DELETE FROM receipt_payment_links; DELETE FROM attachments; DELETE FROM payments; DELETE FROM sales; DELETE FROM audit_events;
    UPDATE users SET active=1,permissions_json='["sales","sales.payments"]' WHERE id='staff';
    INSERT INTO sales VALUES('sale','store','completed',3473000,3473000,0),('foreign','other','completed',100,100,0);
    INSERT INTO payments VALUES('p1','store','sale','pix','bank1','Bank',3473000,0),('foreign-p','other','foreign','pix','bank2','Other',100,0);
    INSERT INTO attachments(id,store_id,sale_id,kind,receipt_amount_cents,receipt_amount_source,receipt_amount_confirmed_at) VALUES('r1','store','sale','receipt',1500000,'ocr',1),('r2','store','sale','receipt',1965000,'ocr',2),('photo','store','sale','item_photo',99999999,'ocr',3),('foreign-r','other','foreign','receipt',99999999,'ocr',1);`);
}
const enqueue = (id: string, target: string | null = null, override = {}) =>
  db.batch(
    requestReceiptPaymentSync(
      database,
      { ...scope, ...override },
      id,
      Date.now(),
      target,
    ),
  );
const settle = () => settleReceiptPaymentSync(database, 'store', 'sale');
seed();
await processReceiptPaymentSync(database);
assert.equal(
  received(),
  3465000,
  'Safe receipts are income even before the legacy sync request settles',
);
assert.equal(get('SELECT COUNT(*) AS n FROM audit_events').n, 0);
await enqueue('two-receipts');
await settle();
assert.equal(received(), 3465000);
assert.equal(
  get("SELECT received_difference_cents AS n FROM sales WHERE id='sale'").n,
  0,
  'Legacy persisted totals remain historical; readers derive receipt income',
);
assert.equal(
  get("SELECT amount_cents AS n FROM payments WHERE id='p1'").n,
  3473000,
);
assert.equal(
  get("SELECT amount_cents AS n FROM payments WHERE id='foreign-p'").n,
  100,
);
const audit = JSON.parse(
  String(
    get(
      "SELECT details_json AS d FROM audit_events WHERE action='sale.receipts_verified'",
    ).d,
  ),
);
assert.deepEqual(audit.receiptIds, ['r1', 'r2']);
assert.equal(audit.source, 'receipt-income');
await settle();
await processReceiptPaymentSync(database);
assert.equal(get('SELECT COUNT(*) AS n FROM audit_events').n, 3);

seed();
db.database.exec(
  "UPDATE attachments SET receipt_amount_cents=NULL WHERE id='r2'",
);
await enqueue('partial');
await settle();
assert.equal(received(), 1500000);
db.database.exec(
  "UPDATE attachments SET receipt_amount_cents=1965000 WHERE id='r2'",
);
await processReceiptPaymentSync(database);
assert.equal(received(), 3465000);

// A later manual edit, including an unchanged value, closes the earlier intent.
seed();
await enqueue('manual-wins');
await db.batch([
  stopReceiptPaymentSync(database, 'store', 'sale', Date.now()),
  db.prepare("UPDATE payments SET amount_cents=3400000 WHERE id='p1'"),
  db.prepare(
    "UPDATE sales SET received_total_cents=3400000,received_difference_cents=-73000 WHERE id='sale'",
  ),
]);
await settle();
assert.equal(received(), 3465000);
await enqueue('new-upload');
await settle();
assert.equal(received(), 3465000);

// Concurrent manual edit between read and transaction; pending request CAS wins.
seed();
await enqueue('race');
const raced = {
  prepare: db.prepare.bind(db),
  batch: async (statements: { sql: string }[]) => {
    if (
      statements.some((statement) =>
        statement.sql.includes("'sale.receipts_verified'"),
      )
    )
      await stopReceiptPaymentSync(database, 'store', 'sale', Date.now()).run();
    return db.batch(statements);
  },
} as unknown as D1Database;
await settleReceiptPaymentSync(raced, 'store', 'sale');
assert.equal(received(), 3465000);
assert.equal(get('SELECT COUNT(*) AS n FROM audit_events').n, 0);

// Changed receipt snapshot cannot settle an older, already-read amount.
seed();
await enqueue('receipt-race');
const changedReceipt = {
  prepare: db.prepare.bind(db),
  batch: async (statements: { sql: string }[]) => {
    if (
      statements.some((statement) =>
        statement.sql.includes("'sale.receipts_verified'"),
      )
    )
      db.database.exec(
        "UPDATE attachments SET receipt_amount_cents=1950000 WHERE id='r2'",
      );
    return db.batch(statements);
  },
} as unknown as D1Database;
await settleReceiptPaymentSync(changedReceipt, 'store', 'sale');
assert.equal(received(), 3450000);
await settle();
assert.equal(received(), 3450000);

// Never allocate silently between multiple Pix accounts.
seed();
db.database.exec(
  "UPDATE payments SET amount_cents=3000000 WHERE id='p1'; INSERT INTO payments VALUES('p2','store','sale','pix','bank2','Bank2',465000,0); INSERT INTO payments VALUES('cash','store','sale','cash',NULL,NULL,8000,0)",
);
await enqueue('multiple-already-matched');
await settle();
assert.equal(received(), 3473000);
assert.equal(
  (await readReceiptPaymentSync(database, 'store', 'sale'))!.request!.status,
  'applied',
);
assert.equal(
  get("SELECT amount_cents AS n FROM payments WHERE id='p1'").n,
  3000000,
);
assert.equal(
  get("SELECT amount_cents AS n FROM payments WHERE id='p2'").n,
  465000,
);
assert.equal(
  get("SELECT amount_cents AS n FROM payments WHERE id='cash'").n,
  8000,
);
seed();
db.database.exec(
  "UPDATE payments SET amount_cents=3000000 WHERE id='p1'; INSERT INTO payments VALUES('p2','store','sale','pix','bank2','Bank2',473000,0)",
);
await enqueue('multiple');
await settle();
assert.equal(received(), 3465000);
assert.equal(
  (await readReceiptPaymentSync(database, 'store', 'sale'))!.request!.status,
  'applied',
);
await enqueue('choose-first', 'p1');
await settle();
assert.equal(received(), 3465000);
assert.equal(
  get("SELECT amount_cents AS n FROM payments WHERE id='p2'").n,
  473000,
);
assert.equal(
  get("SELECT amount_cents AS n FROM payments WHERE id='p1'").n,
  3000000,
);
await enqueue('foreign-target', 'foreign-p');
await settle();
assert.equal(received(), 3465000);

seed();
db.database.exec(
  "UPDATE attachments SET receipt_amount_cents=1 WHERE kind='receipt' AND store_id='store'; UPDATE payments SET amount_cents=3000000 WHERE id='p1'; INSERT INTO payments VALUES('p2','store','sale','pix','bank2','Bank2',473000,0)",
);
await enqueue('negative', 'p1');
await settle();
assert.equal(received(), 2);

seed();
db.database
  .exec(`UPDATE sales SET products_total_cents=710000, received_total_cents=710000 WHERE id='sale';
  UPDATE payments SET amount_cents=410000 WHERE id='p1';
  INSERT INTO payments VALUES('cash','store','sale','cash',NULL,NULL,300000,0);
  DELETE FROM attachments WHERE id='r2'; UPDATE attachments SET receipt_amount_cents=410000 WHERE id='r1'`);
await enqueue('mixed-matched');
await settle();
assert.equal(received(), 710000);
assert.equal(
  get("SELECT amount_cents AS n FROM payments WHERE id='cash'").n,
  300000,
);
db.database.exec(
  "UPDATE attachments SET receipt_amount_cents=400000 WHERE id='r1'",
);
await enqueue('mixed-new-proof');
await settle();
assert.equal(received(), 700000);
assert.equal(
  get("SELECT amount_cents AS n FROM payments WHERE id='p1'").n,
  410000,
);
assert.equal(
  get("SELECT amount_cents AS n FROM payments WHERE id='cash'").n,
  300000,
);
await settle();
assert.equal(received(), 700000);
// Legacy allocation targets are ignored; receipt income never changes cash.
await enqueue('legacy-cash', 'cash');
await settle();
assert.equal(
  (await readReceiptPaymentSync(database, 'store', 'sale'))!.request!.status,
  'applied',
);
assert.equal(received(), 700000);
await enqueue('cash-race');
const cashRace = {
  prepare: db.prepare.bind(db),
  batch: async (statements: { sql: string }[]) => {
    if (
      statements.some((statement) =>
        statement.sql.includes("'sale.receipts_verified'"),
      )
    )
      db.database.exec(
        "UPDATE payments SET amount_cents=290000 WHERE id='cash'; UPDATE sales SET received_total_cents=690000 WHERE id='sale'",
      );
    return db.batch(statements);
  },
} as unknown as D1Database;
await settleReceiptPaymentSync(cashRace, 'store', 'sale');
assert.equal(received(), 690000);
assert.equal(
  get("SELECT amount_cents AS n FROM payments WHERE id='cash'").n,
  290000,
);
assert.equal(
  get(
    "SELECT COUNT(*) AS n FROM audit_events WHERE id='receipt-payment:cash-race'",
  ).n,
  0,
);
seed();
db.database.exec(
  "UPDATE payments SET method='cash',pix_account_id=NULL,account_name=NULL WHERE id='p1'",
);
await enqueue('cash-only');
await settle();
assert.equal(received(), 6938000);
assert.equal(
  get("SELECT amount_cents AS n FROM payments WHERE id='p1'").n,
  3473000,
);
assert.equal(
  get(
    "SELECT COUNT(*) AS n FROM audit_events WHERE action<>'sale.receipt_review'",
  ).n,
  3,
);
assert.equal(
  get(
    "SELECT COUNT(*) AS n FROM audit_events WHERE action='sale.receipt_review'",
  ).n,
  0,
);
assert.equal(
  get(
    "SELECT SUM(amount_cents) AS n FROM payments WHERE sale_id='sale' AND store_id='store' AND method='pix'",
  ).n,
  3465000,
);
seed();
db.database.exec("UPDATE sales SET status='cancelled' WHERE id='sale'");
await enqueue('cancelled');
await settle();
assert.equal(received(), 3465000);
seed();
await enqueue('permission', null, {
  actorId: 'staff',
  subject: {
    role: 'operator' as const,
    permissions: ['sales', 'sales.payments'] as const,
  },
});
db.database.exec(
  "UPDATE users SET permissions_json='[\"sales\"]' WHERE id='staff'",
);
await settle();
assert.equal(received(), 3465000);
seed();
await enqueue('no-permission', null, {
  subject: { role: 'operator' as const, permissions: [] },
});
assert.equal(get('SELECT COUNT(*) AS n FROM sale_receipt_payment_sync').n, 0);
seed();
await enqueue('overpayment');
db.database.exec(
  "UPDATE attachments SET receipt_amount_cents=2000000 WHERE id='r2'",
);
await settle();
assert.equal(received(), 3500000);
assert.equal(
  get("SELECT received_difference_cents AS n FROM sales WHERE id='sale'").n,
  0,
  'Legacy persisted difference remains historical after receipt verification',
);
// Receipt-only uploads may verify evidence because no historical Pix is mutated.
seed();
await enqueue('owner-pending');
await enqueue('receipt-only-upload', null, {
  subject: {
    role: 'operator' as const,
    permissions: ['sales', 'sales.receipts'] as const,
  },
});
await settle();
assert.equal(received(), 3465000);
assert.equal(
  (await readReceiptPaymentSync(database, 'store', 'sale'))!.request!.status,
  'applied',
);
db.close();
console.log(
  'Receipt payment sync: safe receipt income, partial reads, historical Pix preservation, concurrent CAS, tenants, cash preservation, audit and replay passed.',
);
