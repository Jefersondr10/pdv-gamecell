import assert from 'node:assert/strict';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import {
  readReceiptPaymentSync,
  registerFirstReceiptPix,
  requestReceiptPaymentSync,
  settleReceiptPaymentSync,
  stopReceiptPaymentSync,
} from '../lib/server/receipt-payment-sync.ts';
import { originalSalePayments } from '../lib/server/original-sale-payments.ts';

const adapter = new SqliteDatabase(':memory:');
const db = adapter as unknown as D1Database;
const sql = adapter.database;
sql.exec(`
CREATE TABLE users(id TEXT PRIMARY KEY,store_id TEXT,role TEXT,permissions_json TEXT,active INTEGER);
CREATE TABLE pix_accounts(id TEXT PRIMARY KEY,store_id TEXT,name TEXT,active INTEGER);
CREATE TABLE sales(id TEXT PRIMARY KEY,store_id TEXT,status TEXT,products_total_cents INTEGER,received_total_cents INTEGER,received_difference_cents INTEGER);
CREATE TABLE payments(id TEXT PRIMARY KEY,store_id TEXT,sale_id TEXT,method TEXT,pix_account_id TEXT,account_name TEXT,amount_cents INTEGER,created_at INTEGER);
CREATE TABLE attachments(id TEXT PRIMARY KEY,store_id TEXT,sale_id TEXT,kind TEXT,receipt_amount_cents INTEGER,receipt_amount_source TEXT,receipt_amount_confirmed_at INTEGER);
CREATE TABLE audit_events(id TEXT PRIMARY KEY,store_id TEXT,actor_user_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT NOT NULL,details_json TEXT,created_at INTEGER);
CREATE TABLE sale_receipt_payment_sync(sale_id TEXT PRIMARY KEY,store_id TEXT,request_id TEXT,requested_by TEXT,target_payment_id TEXT,status TEXT,updated_at INTEGER);
INSERT INTO users VALUES('owner','shop','owner',NULL,1);
INSERT INTO pix_accounts VALUES('bank','shop','Escolhida',1),('foreign','elsewhere','Outra loja',1),('inactive','shop','Inativa',0);
`);
const scope = {
  storeId: 'shop',
  saleId: 'sale',
  actorId: 'owner',
  subject: { role: 'owner' as const },
};
function seed() {
  sql.exec(`DELETE FROM payments; DELETE FROM attachments; DELETE FROM sales; DELETE FROM audit_events; DELETE FROM sale_receipt_payment_sync;
    UPDATE users SET active=1; UPDATE pix_accounts SET active=1 WHERE id='bank';
    INSERT INTO sales VALUES('sale','shop','completed',710000,300000,-410000);
    INSERT INTO payments VALUES('cash','shop','sale','cash',NULL,NULL,300000,1);
    INSERT INTO attachments VALUES('receipt','shop','sale','receipt',410000,'ocr',1);`);
}
const state = async () => (await readReceiptPaymentSync(db, 'shop', 'sale'))!;
const input = (operationId: string, pixAccountId = 'bank') => ({
  operationId,
  pixAccountId,
  requestDetails: JSON.stringify({ operationId, pixAccountId }),
});
const register = async (operationId: string) =>
  registerFirstReceiptPix(
    db,
    scope,
    await state(),
    input(operationId),
    Date.now(),
  );
const paid = () =>
  sql
    .prepare("SELECT received_total_cents AS n FROM sales WHERE id='sale'")
    .get()!.n;
const audits = () =>
  sql.prepare('SELECT COUNT(*) AS n FROM audit_events').get()!.n;

seed();
await register('mixed');
const current = await state();
assert.equal(current.pixCents, 410000);
assert.equal(current.cashCents, 300000);
assert.equal(paid(), 710000);
assert.equal(current.request!.status, 'applied');
assert.equal(
  current.payments.find((p) => p.method === 'pix')!.pixAccountId,
  'bank',
);
assert.equal(audits(), 2);
assert.deepEqual(
  (await originalSalePayments(db, 'shop', 'sale')).results.map((row) => ({
    ...row,
  })),
  [{ method: 'cash', pixAccountId: null, amountCents: 300000 }],
);
await assert.rejects(register('second-pix'), /venda mudou/i);
assert.equal(audits(), 2);
sql.exec(
  "UPDATE attachments SET receipt_amount_cents=400000 WHERE id='receipt'",
);
await adapter.batch(
  requestReceiptPaymentSync(db, scope, 'new-proof', Date.now()),
);
await settleReceiptPaymentSync(db, 'shop', 'sale');
assert.equal(paid(), 700000);
assert.equal((await state()).cashCents, 300000);
assert.deepEqual(
  (await originalSalePayments(db, 'shop', 'sale')).results.map((row) => ({
    ...row,
  })),
  [{ method: 'cash', pixAccountId: null, amountCents: 300000 }],
);

seed();
sql.exec(
  'DELETE FROM payments; UPDATE sales SET received_total_cents=0,received_difference_cents=-710000',
);
await register('empty');
assert.equal(paid(), 410000);
assert.equal((await state()).payments.length, 1);
assert.deepEqual((await originalSalePayments(db, 'shop', 'sale')).results, []);

seed();
sql.exec('UPDATE sales SET products_total_cents=400000');
await register('above-sale');
assert.equal(paid(), 710000); // Never shrink a real receipt to make the sale match.
assert.equal((await state()).sale.receivedDifferenceCents, 310000);

for (const account of ['foreign', 'inactive', 'missing']) {
  seed();
  await assert.rejects(
    registerFirstReceiptPix(
      db,
      scope,
      await state(),
      input('bad-bank', account),
      Date.now(),
    ),
    /conta Pix ativa/i,
  );
  assert.equal(paid(), 300000);
  assert.equal(audits(), 0);
}
for (const amount of ['NULL', '0', '-1', '1.5', '1000000001']) {
  seed();
  sql.exec(`UPDATE attachments SET receipt_amount_cents=${amount}`);
  await assert.rejects(register('invalid'), /leitura|corrija/i);
  assert.equal(audits(), 0);
}
seed();
await assert.rejects(
  registerFirstReceiptPix(
    db,
    {
      ...scope,
      subject: { role: 'operator', permissions: ['sales', 'sales.receipts'] },
    },
    await state(),
    input('permission'),
    Date.now(),
  ),
  /acesso/i,
);
sql.exec('UPDATE users SET active=0');
await assert.rejects(register('revoked'), /acesso/i);
assert.equal(audits(), 0);

// Each snapshot guard rejects the whole transaction, retaining the newer edit.
for (const mutation of [
  "UPDATE payments SET amount_cents=290000 WHERE id='cash'; UPDATE sales SET received_total_cents=290000",
  "UPDATE attachments SET receipt_amount_cents=400000 WHERE id='receipt'",
  "UPDATE sales SET status='cancelled'",
  "INSERT INTO payments VALUES('other-pix','shop','sale','pix','bank','Escolhida',100,2)",
]) {
  seed();
  const before = await state();
  sql.exec(mutation);
  await assert.rejects(
    registerFirstReceiptPix(db, scope, before, input('stale'), Date.now()),
    /venda|conta mudou/i,
  );
  assert.equal(audits(), 0);
  assert.equal(
    sql
      .prepare(
        "SELECT COUNT(*) AS n FROM payments WHERE id NOT IN ('cash','other-pix')",
      )
      .get()!.n,
    0,
  );
}
seed();
const priorIntent = await state();
await adapter.batch(requestReceiptPaymentSync(db, scope, 'intent', Date.now()));
await adapter.batch([stopReceiptPaymentSync(db, 'shop', 'sale', Date.now())]);
await assert.rejects(
  registerFirstReceiptPix(
    db,
    scope,
    priorIntent,
    input('old-intent'),
    Date.now(),
  ),
  /mudou/i,
);
assert.equal(audits(), 0);

for (const mutate of [
  "UPDATE pix_accounts SET active=0 WHERE id='bank'",
  'UPDATE users SET active=0',
]) {
  seed();
  const raced = {
    prepare: adapter.prepare.bind(adapter),
    batch: async (statements: unknown[]) => {
      if (statements.length === 5) sql.exec(mutate);
      return adapter.batch(statements);
    },
  } as unknown as D1Database;
  await assert.rejects(
    registerFirstReceiptPix(
      raced,
      scope,
      await state(),
      input('race'),
      Date.now(),
    ),
    /mudou/i,
  );
  assert.equal(audits(), 0);
  assert.equal(paid(), 300000);
}
seed();
const broken = {
  prepare: adapter.prepare.bind(adapter),
  batch: async (statements: unknown[]) =>
    adapter.batch([
      ...statements.slice(0, 2),
      adapter.prepare('INSERT INTO missing_table VALUES(1)'),
      ...statements.slice(2),
    ]),
} as unknown as D1Database;
await assert.rejects(
  registerFirstReceiptPix(
    broken,
    scope,
    await state(),
    input('rollback'),
    Date.now(),
  ),
);
assert.equal(audits(), 0);
assert.equal(paid(), 300000);
assert.equal((await state()).payments.length, 1);
adapter.close();
console.log(
  'First receipt Pix: explicit bank, empty/mixed sale, no duplicate Pix, preserved cash/original replay, amounts, permissions, account/receipt/payment races and atomic rollback passed.',
);
