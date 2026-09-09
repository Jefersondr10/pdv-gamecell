import assert from 'node:assert/strict';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import { changeSalePrices, readSalePrices } from '../lib/server/sale-prices.ts';
import {
  originalPriceSnapshot,
  parseSalePriceInput,
  applySalePrices,
} from '../lib/sale-prices.ts';
import type { SaleRecord } from '../lib/pdv-types.ts';
import { saleDisplayStatus } from '../lib/sale-display-status.ts';
import { deriveReceiptReconciliation } from '../lib/receipt-reconciliation.ts';

for (const text of ['-10,00', '−10,00', '(10,00)', 'abc10', '+10', '', '0'])
  assert.equal(parseSalePriceInput(text), 0, `Reject invalid price ${text}`);
for (const text of ['4.950,00', '4950', 'R$ 4.950,00'])
  assert.equal(parseSalePriceInput(text), 495000);

// Updating the price must immediately reevaluate the three totals and every status.
const saleFixture = {
  id: 'sale',
  status: 'completed',
  productsTotalCents: 3473000,
  receivedTotalCents: 3473000,
  receivedDifferenceCents: 0,
  items: [{ id: 'item', soldPriceCents: 3473000, photos: [{}] }],
  receipts: [{ receiptAmountCents: 1500000 }, { receiptAmountCents: 1965000 }],
  payments: [{ amountCents: 3473000 }],
  reconciliation: deriveReceiptReconciliation(
    [{ amountCents: 3465000 }],
    3473000,
  ),
} as SaleRecord;
const applyFixture = (total: number, paid = 3473000) =>
  applySalePrices(saleFixture, {
    revision: 1,
    status: 'completed',
    productsTotalCents: total,
    receivedTotalCents: paid,
    receivedDifferenceCents: paid - total,
    priceDifferenceCents: 0,
    items: [{ id: 'item', soldPriceCents: total }],
  });
assert.equal(saleDisplayStatus(applyFixture(3465000)).key, 'overpaid');
assert.equal(saleDisplayStatus(applyFixture(3500000)).key, 'review');
assert.equal(
  saleDisplayStatus(applyFixture(3465000, 3465000)).key,
  'reconciled',
);
assert.equal(applyFixture(3500000).reconciliation.differenceCents, -35000);
assert.equal(applyFixture(3500000).payments, saleFixture.payments);
assert.equal(applyFixture(3500000).receipts, saleFixture.receipts);
assert.equal(saleFixture.items[0].soldPriceCents, 3473000);
const adapter = new SqliteDatabase(':memory:');
const db = adapter as unknown as D1Database;
adapter.database
  .exec(`CREATE TABLE sales(id TEXT PRIMARY KEY,store_id TEXT,status TEXT,products_total_cents INTEGER,received_total_cents INTEGER,received_difference_cents INTEGER,reference_total_cents INTEGER,price_difference_cents INTEGER);
CREATE TABLE sale_items(id TEXT PRIMARY KEY,store_id TEXT,sale_id TEXT,sold_price_cents INTEGER,reference_price_cents INTEGER,serial TEXT);
CREATE TABLE audit_events(id TEXT PRIMARY KEY,store_id TEXT,actor_user_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT NOT NULL,details_json TEXT,created_at INTEGER);
CREATE TABLE payments(id TEXT PRIMARY KEY,sale_id TEXT,amount_cents INTEGER);
CREATE TABLE products(id TEXT,default_price_cents INTEGER);
CREATE TABLE inventory_units(id TEXT,status TEXT,sale_id TEXT);
INSERT INTO payments VALUES('p','s',10000);
INSERT INTO products VALUES('prod',6000);
INSERT INTO inventory_units VALUES('u','sold','s');`);
const scope = {
  storeId: 'store',
  actorId: 'owner',
  saleId: 's',
  subject: { role: 'owner' as const },
};
const sql = adapter.database;
const row = (query: string) => sql.prepare(query).get();
function seed() {
  sql.exec(`DELETE FROM sales; DELETE FROM sale_items; DELETE FROM audit_events;
    INSERT INTO sales VALUES('s','store','completed',10000,10000,0,6000,-1000),('f','other','completed',10,0,-10,0,0);
    INSERT INTO sale_items VALUES('i1','store','s',5000,6000,'SN1'),('i2','store','s',5000,0,'SN2'),('fi','other','f',10,0,'OTHER');`);
}
const payload = (
  first = 6000,
  second = 5000,
  revision = 0,
  oldFirst = 5000,
  oldSecond = 5000,
) => ({
  operationId: crypto.randomUUID(),
  revision,
  items: [
    { id: 'i1', expectedPriceCents: oldFirst, priceCents: first },
    { id: 'i2', expectedPriceCents: oldSecond, priceCents: second },
  ],
});
const run = (body: Record<string, unknown>) =>
  changeSalePrices(db, scope, body);
const rejected = (promise: Promise<unknown>, status: number) =>
  assert.rejects(
    promise,
    (error: unknown) => (error as { status: number }).status === status,
  );
seed();
const unchanged = ['payments', 'products', 'inventory_units'].map((table) =>
  row(`SELECT * FROM ${table}`),
);
const initial = payload();
const updated = await run(initial);
assert.equal(updated.productsTotalCents, 11000);
assert.equal(updated.receivedTotalCents, 10000);
assert.equal(updated.receivedDifferenceCents, -1000);
assert.equal(updated.priceDifferenceCents, 0);
assert.equal(updated.revision, 1);
assert.equal(
  row("SELECT reference_total_cents FROM sales WHERE id='s'")!
    .reference_total_cents,
  6000,
);
assert.equal(row("SELECT serial FROM sale_items WHERE id='i1'")!.serial, 'SN1');
assert.deepEqual(
  ['payments', 'products', 'inventory_units'].map((table) =>
    row(`SELECT * FROM ${table}`),
  ),
  unchanged,
);
const audit = JSON.parse(
  row('SELECT details_json FROM audit_events')!.details_json as string,
);
assert.equal(audit.before.totalCents, 10000);
assert.equal(audit.after.totalCents, 11000);
assert.equal(audit.before.items[0].soldPriceCents, 5000);
assert.equal(audit.after.items[0].soldPriceCents, 6000);
assert.equal(audit.before.items[0].serial, 'SN1');
assert.equal(audit.before.revision, 0);
assert.equal(audit.before.receivedDifferenceCents, 0);
assert.equal(audit.after.receivedDifferenceCents, -1000);
assert.equal(
  originalPriceSnapshot(JSON.stringify(audit.before))?.totalCents,
  10000,
);
assert.equal(originalPriceSnapshot('bad JSON'), null);
await rejected(run(payload(6000, 5000, 1, 6000, 5000)), 400);
assert.equal(
  row('SELECT actor_user_id FROM audit_events')!.actor_user_id,
  'owner',
);
assert.equal((await run(initial)).replayed, true);
assert.equal(row('SELECT COUNT(*) AS n FROM audit_events')!.n, 1);
await rejected(run({ ...initial, items: payload(7000).items }), 409);
await rejected(
  changeSalePrices(db, { ...scope, actorId: 'other' }, initial),
  409,
);
const below = await run(payload(4000, 5000, 1, 6000));
assert.equal(below.receivedDifferenceCents, 1000);
assert.equal(below.priceDifferenceCents, -2000);
// Return to old prices, but reject the original revision (ABA).
await run(payload(5000, 5000, 2, 4000));
await rejected(run(payload(7000)), 409);
seed();
for (const body of [
  { ...payload(), operationId: undefined },
  { ...payload(), items: [] },
  { ...payload(), items: payload().items.slice(0, 1) },
  { ...payload(), items: [payload().items[0], payload().items[0]] },
  payload(0),
  payload(-1),
  payload(1.5),
  payload(1000000001),
  { ...payload(), extra: 'reject' },
])
  await rejected(run(body), body.items?.length === 1 ? 409 : 400);
await rejected(
  changeSalePrices(db, { ...scope, storeId: 'other' }, payload()),
  404,
);
await rejected(
  changeSalePrices(db, { ...scope, subject: { role: 'operator' } }, payload()),
  403,
);
await rejected(
  run({
    ...payload(),
    items: [
      { id: 'fi', expectedPriceCents: 10, priceCents: 100 },
      payload().items[1],
    ],
  }),
  409,
);
sql.exec("UPDATE sales SET status='cancelled' WHERE id='s'");
await rejected(run(payload()), 409);
seed();
const outcomes = await Promise.allSettled([
  run(payload(6000)),
  run(payload(7000)),
]);
assert.equal(
  outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
  1,
);
assert.equal(row('SELECT COUNT(*) AS n FROM audit_events')!.n, 1);
seed();
const same = payload();
await Promise.all([run(same), run(same)]);
assert.equal(row('SELECT COUNT(*) AS n FROM audit_events')!.n, 1);
seed();
sql.exec(
  "CREATE TRIGGER fail_prices BEFORE UPDATE ON sales BEGIN SELECT RAISE(ABORT,'test rollback'); END;",
);
await assert.rejects(run(payload()), /test rollback/);
assert.equal(
  row("SELECT sold_price_cents FROM sale_items WHERE id='i1'")!
    .sold_price_cents,
  5000,
);
assert.equal(row('SELECT COUNT(*) AS n FROM audit_events')!.n, 0);
sql.exec('DROP TRIGGER fail_prices');
seed();
const batch = adapter.batch.bind(adapter);
// Payment committed after our initial read must be retained in the new balance.
adapter.batch = async (statements) => {
  sql.exec(
    "UPDATE sales SET received_total_cents=15000,received_difference_cents=5000 WHERE id='s'",
  );
  return batch(statements);
};
assert.equal((await run(payload())).receivedDifferenceCents, 4000);
adapter.batch = batch;
seed();
adapter.batch = async (statements) => {
  await batch(statements);
  throw new Error('uncertain commit');
};
assert.equal((await run(payload())).productsTotalCents, 11000);
adapter.batch = batch;
assert.equal((await readSalePrices(db, scope)).revision, 1);
adapter.close();
console.log(
  'PASS: price editing, under/over/equal payment, financial/catalog/stock invariants, reference-zero handling, permission/tenant/cancel guards, optimistic revision, ABA, replay, rollback and concurrent payment.',
);
