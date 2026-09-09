import assert from 'node:assert/strict';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import { originalSalePayments } from '../lib/server/original-sale-payments.ts';
const db = new SqliteDatabase(':memory:');
db.database
  .exec(`CREATE TABLE payments(id TEXT,store_id TEXT,sale_id TEXT,method TEXT,pix_account_id TEXT,amount_cents INTEGER,created_at INTEGER);
CREATE TABLE audit_events(id TEXT,store_id TEXT,entity_id TEXT,action TEXT,details_json TEXT,created_at INTEGER);
INSERT INTO payments VALUES('initial','a','s','pix','bank',100,1),('later','a','s','cash',NULL,200,2),('foreign','b','s','cash',NULL,999,1);
INSERT INTO audit_events VALUES('later','a','s','sale.payment_added','{}',2);`);
const read = async () =>
  (
    await originalSalePayments(db as unknown as D1Database, 'a', 's')
  ).results.map((row) => ({ ...row }));
assert.deepEqual(await read(), [
  { method: 'pix', pixAccountId: 'bank', amountCents: 100 },
]);
db.database.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?)').run(
  'correction',
  'a',
  's',
  'sale.payment_from_receipts',
  JSON.stringify({
    before: [
      { id: 'initial', method: 'pix', pixAccountId: 'bank', amountCents: 100 },
      { id: 'later', method: 'cash', pixAccountId: null, amountCents: 200 },
    ],
  }),
  3,
);
db.database.exec(
  "UPDATE payments SET amount_cents=500,method='cash',pix_account_id=NULL WHERE id='initial'",
);
db.database.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?)').run(
  'newer',
  'a',
  's',
  'sale.payments_corrected',
  JSON.stringify({
    before: [
      { id: 'initial', method: 'cash', pixAccountId: null, amountCents: 500 },
    ],
  }),
  4,
);
assert.deepEqual(await read(), [
  { method: 'pix', pixAccountId: 'bank', amountCents: 100 },
]);
assert.equal(
  db.database
    .prepare("SELECT amount_cents AS n FROM payments WHERE id='initial'")
    .get()!.n,
  500,
);
db.database.exec("DELETE FROM payments WHERE id='initial'");
assert.deepEqual(await read(), []);
db.close();
console.log(
  'Original payment reconstruction: additions excluded, earliest automatic/manual history, null account and tenant isolation passed.',
);
