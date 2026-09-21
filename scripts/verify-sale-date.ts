import assert from 'node:assert/strict';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import { changeSaleDate, readSaleDate } from '../lib/server/sale-date.ts';
import { can } from '../lib/permissions.ts';

const adapter = new SqliteDatabase(':memory:');
const db = adapter as unknown as D1Database;
const entryAt = Date.parse('2026-09-10T09:00:00-03:00');
const originalAt = Date.parse('2026-09-10T10:00:00-03:00');
const correctedAt = Date.parse('2026-09-09T11:30:00-03:00');

adapter.database.exec(`
  CREATE TABLE sales (id TEXT PRIMARY KEY, store_id TEXT, status TEXT, created_at INTEGER,
    products_total_cents INTEGER, received_total_cents INTEGER);
  CREATE TABLE entries (id TEXT PRIMARY KEY, store_id TEXT, created_at INTEGER);
  CREATE TABLE inventory_units (id TEXT PRIMARY KEY, store_id TEXT, entry_id TEXT,
    status TEXT, sale_id TEXT, sold_at INTEGER);
  CREATE TABLE sale_items (id TEXT PRIMARY KEY, store_id TEXT, sale_id TEXT,
    inventory_unit_id TEXT, created_at INTEGER);
  CREATE TABLE payments (id TEXT PRIMARY KEY, store_id TEXT, sale_id TEXT,
    amount_cents INTEGER, created_at INTEGER);
  CREATE TABLE attachments (id TEXT PRIMARY KEY, store_id TEXT, sale_id TEXT,
    created_at INTEGER);
  CREATE TABLE audit_events (id TEXT PRIMARY KEY, store_id TEXT,
    actor_user_id TEXT, action TEXT, entity_type TEXT, entity_id TEXT NOT NULL,
    details_json TEXT, created_at INTEGER);
`);
adapter.database
  .prepare('INSERT INTO sales VALUES (?,?,?,?,?,?)')
  .run('sale', 'shop', 'completed', originalAt, 515000, 515000);
adapter.database
  .prepare('INSERT INTO sales VALUES (?,?,?,?,?,?)')
  .run('cancelled', 'shop', 'cancelled', originalAt, 1, 0);
adapter.database
  .prepare('INSERT INTO sales VALUES (?,?,?,?,?,?)')
  .run('foreign', 'other', 'completed', originalAt, 1, 0);
adapter.database
  .prepare('INSERT INTO entries VALUES (?,?,?)')
  .run('entry', 'shop', entryAt);
adapter.database
  .prepare('INSERT INTO inventory_units VALUES (?,?,?,?,?,?)')
  .run('unit', 'shop', 'entry', 'sold', 'sale', originalAt);
adapter.database
  .prepare('INSERT INTO sale_items VALUES (?,?,?,?,?)')
  .run('item', 'shop', 'sale', 'unit', originalAt);
adapter.database
  .prepare('INSERT INTO payments VALUES (?,?,?,?,?)')
  .run('payment', 'shop', 'sale', 515000, originalAt + 10);
adapter.database
  .prepare('INSERT INTO attachments VALUES (?,?,?,?)')
  .run('receipt', 'shop', 'sale', originalAt + 20);

const scope = { actorId: 'manager', saleId: 'sale', storeId: 'shop' };
const initial = await readSaleDate(db, 'shop', 'sale');
assert.equal(initial.createdAt, originalAt);
assert.equal(initial.minimumCreatedAt, Date.UTC(2020, 0, 1));
assert.equal(initial.revision, 0);
await assert.rejects(() => readSaleDate(db, 'shop', 'foreign'), {
  code: 'SALE_NOT_FOUND',
});

const payload = (
  createdAt: number,
  expected = initial,
  operationId = crypto.randomUUID(),
) => ({
  operationId,
  expected: {
    createdAt: expected.createdAt,
    revision: expected.revision,
  },
  createdAt,
});

await assert.rejects(
  () => changeSaleDate(db, scope, { ...payload(correctedAt), invented: true }),
  { code: 'UNKNOWN_FIELD' },
);
await assert.rejects(
  () => changeSaleDate(db, scope, payload(Date.UTC(2020, 0, 1) - 1)),
  { code: 'INVALID_FIELD' },
);
await assert.rejects(
  () => changeSaleDate(db, scope, payload(Date.now() + 60 * 60 * 1000)),
  { code: 'SALE_DATE_IN_FUTURE' },
);
await assert.rejects(
  () =>
    changeSaleDate(db, { ...scope, saleId: 'cancelled' }, payload(correctedAt)),
  { code: 'SALE_CANCELLED' },
);

const firstInput = payload(correctedAt);
const first = await changeSaleDate(db, scope, firstInput);
assert.equal(first.replayed, false);
assert.equal(first.current.createdAt, correctedAt);
assert.equal(first.current.revision, 1);
assert.ok(first.current.createdAt < entryAt, 'sales can predate stock entry');
assert.equal(
  adapter.database
    .prepare('SELECT created_at FROM entries WHERE id=?')
    .get('entry')!.created_at,
  entryAt,
  'backdating a sale must not change its stock entry',
);
assert.deepEqual(
  {
    ...adapter.database
      .prepare('SELECT status,sale_id,entry_id FROM inventory_units WHERE id=?')
      .get('unit'),
  },
  { status: 'sold', sale_id: 'sale', entry_id: 'entry' },
  'the sold unit stays assigned to the same sale and entry',
);
assert.equal(
  adapter.database
    .prepare('SELECT sold_at FROM inventory_units WHERE id=?')
    .get('unit')!.sold_at,
  correctedAt,
);
assert.deepEqual(
  {
    ...adapter.database
      .prepare(
        `SELECT products_total_cents,received_total_cents FROM sales WHERE id=?`,
      )
      .get('sale'),
  },
  { products_total_cents: 515000, received_total_cents: 515000 },
);
assert.equal(
  adapter.database
    .prepare('SELECT created_at FROM sale_items WHERE id=?')
    .get('item')!.created_at,
  originalAt,
);
assert.equal(
  adapter.database
    .prepare('SELECT created_at FROM payments WHERE id=?')
    .get('payment')!.created_at,
  originalAt + 10,
);
assert.equal(
  adapter.database
    .prepare('SELECT created_at FROM attachments WHERE id=?')
    .get('receipt')!.created_at,
  originalAt + 20,
);
const audit = JSON.parse(
  String(
    adapter.database
      .prepare('SELECT details_json FROM audit_events WHERE id=?')
      .get(firstInput.operationId)!.details_json,
  ),
);
assert.equal(audit.before.createdAt, originalAt);
assert.equal(audit.after.createdAt, correctedAt);

assert.equal((await changeSaleDate(db, scope, firstInput)).replayed, true);
assert.equal(
  (
    await changeSaleDate(db, scope, firstInput, async () => {
      throw new Error('Replay must not consume the write budget');
    })
  ).replayed,
  true,
);
await assert.rejects(
  () =>
    changeSaleDate(db, scope, {
      ...firstInput,
      createdAt: correctedAt + 60_000,
    }),
  { code: 'OPERATION_ALREADY_USED' },
);
await assert.rejects(
  () => changeSaleDate(db, scope, payload(correctedAt + 60_000, initial)),
  { code: 'SALE_CHANGED' },
);

const secondState = await readSaleDate(db, 'shop', 'sale');
const race = await Promise.allSettled([
  changeSaleDate(db, scope, payload(correctedAt + 60_000, secondState)),
  changeSaleDate(db, scope, payload(correctedAt + 120_000, secondState)),
]);
assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
assert.equal(race.filter((result) => result.status === 'rejected').length, 1);

const afterRace = await readSaleDate(db, 'shop', 'sale');
await changeSaleDate(db, scope, payload(originalAt, afterRace));
await assert.rejects(
  () => changeSaleDate(db, scope, payload(correctedAt, secondState)),
  { code: 'SALE_CHANGED' },
  'revision prevents ABA overwrites',
);

const beforeCancellationRace = await readSaleDate(db, 'shop', 'sale');
const auditCount = Number(
  adapter.database.prepare('SELECT COUNT(*) AS n FROM audit_events').get()!.n,
);
const originalBatch = adapter.batch.bind(adapter);
adapter.batch = async (statements) => {
  adapter.database
    .prepare("UPDATE sales SET status='cancelled' WHERE id='sale'")
    .run();
  return originalBatch(statements);
};
await assert.rejects(
  () =>
    changeSaleDate(
      db,
      scope,
      payload(originalAt + 60_000, beforeCancellationRace),
    ),
  { code: 'SALE_CHANGED' },
);
assert.equal(
  Number(
    adapter.database.prepare('SELECT COUNT(*) AS n FROM audit_events').get()!.n,
  ),
  auditCount,
);
adapter.batch = originalBatch;

assert.equal(can({ role: 'operator' }, 'sales.date'), false);
assert.equal(can({ role: 'admin' }, 'sales.date'), true);
assert.equal(
  can({ role: 'operator', permissions: ['sales', 'sales.date'] }, 'sales.date'),
  true,
);
assert.equal(
  can({ role: 'operator', permissions: ['sales.date'] }, 'sales.date'),
  false,
);

adapter.close();
console.log(
  'PASS: sales can predate stock entry; date validation, tenant scope, audit, replay, concurrency/ABA, cancellation race, stock movement coherence, immutable operational timestamps and permissions.',
);
