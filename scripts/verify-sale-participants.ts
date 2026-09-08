import assert from 'node:assert/strict';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import {
  changeSaleParticipants,
  readSaleParticipants,
  saleParticipantChoices,
} from '../lib/server/sale-participants.ts';
import { can } from '../lib/permissions.ts';
const adapter = new SqliteDatabase(':memory:');
const db = adapter as unknown as D1Database;
adapter.database.exec(`
  CREATE TABLE clients (id TEXT PRIMARY KEY, store_id TEXT, name TEXT, active INTEGER);
  CREATE TABLE users (id TEXT PRIMARY KEY, store_id TEXT, display_name TEXT, role TEXT, permissions_json TEXT, active INTEGER);
  CREATE TABLE sales (id TEXT PRIMARY KEY, store_id TEXT, customer_id TEXT, customer_name TEXT NOT NULL, seller_user_id TEXT, seller_name TEXT NOT NULL, status TEXT, products_total_cents INTEGER, received_total_cents INTEGER);
  CREATE TABLE audit_events (id TEXT PRIMARY KEY, store_id TEXT, actor_user_id TEXT, action TEXT, entity_type TEXT, entity_id TEXT NOT NULL, details_json TEXT, created_at INTEGER);
  INSERT INTO clients VALUES ('c1','a','Cliente Um',1),('c2','a','Cliente Dois',1),('c3','a','Cliente Três',1),('cf','b','Cliente outra loja',1);
  INSERT INTO users VALUES ('s1','a','Vendedor Um','operator',NULL,1),('s2','a','Vendedor Dois','operator',NULL,1),('sf','b','Outra loja','owner',NULL,1),('inactive','a','Inativo','operator',NULL,0),('nosell','a','Sem acesso','operator','[]',1);
  INSERT INTO sales VALUES ('sale','a','c1','Cliente Um','s1','Vendedor Um','completed',500000,300000),('other','b','cf','Outra loja','sf','Outra loja','completed',1,0);
`);
const scope = { storeId: 'a', actorId: 'manager', saleId: 'sale' };
const initial = await readSaleParticipants(db, 'a', 'sale');
const payload = (
  customerId: string | null,
  sellerUserId: string,
  expected = initial,
) => ({
  operationId: crypto.randomUUID(),
  expected: {
    customerId: expected.customerId,
    sellerUserId: expected.sellerUserId,
    revision: expected.revision,
  },
  customerId,
  sellerUserId,
});
const count = () =>
  Number(
    adapter.database.prepare('SELECT COUNT(*) AS n FROM audit_events').get()!.n,
  );
const choice = await saleParticipantChoices(db, 'a', 'sale');
assert.deepEqual(choice.clients.map((c) => c.id).sort(), ['c1', 'c2', 'c3']);
assert.deepEqual(choice.sellers.map((s) => s.id).sort(), ['s1', 's2']);
await assert.rejects(() => readSaleParticipants(db, 'a', 'other'), {
  code: 'SALE_NOT_FOUND',
});
for (const p of [
  payload('cf', 's2'),
  payload('c2', 'sf'),
  payload('c2', 'inactive'),
  payload('c2', 'nosell'),
  payload(null, 's2'),
])
  await assert.rejects(() => changeSaleParticipants(db, scope, p));
assert.equal(count(), 0);
const firstInput = payload('c2', 's2');
const first = await changeSaleParticipants(db, scope, firstInput);
assert.equal(first.current.customerName, 'Cliente Dois');
assert.equal(first.current.sellerName, 'Vendedor Dois');
assert.equal(first.current.revision, 1);
assert.equal(count(), 1);
assert.equal(
  (await changeSaleParticipants(db, scope, firstInput)).replayed,
  true,
);
assert.equal(
  (
    await changeSaleParticipants(db, scope, firstInput, async () => {
      throw new Error('No budget should be charged for a committed retry');
    })
  ).replayed,
  true,
);
assert.equal(count(), 1);
await assert.rejects(
  () => changeSaleParticipants(db, scope, { ...firstInput, customerId: 'c3' }),
  { code: 'OPERATION_ALREADY_USED' },
);
await assert.rejects(
  () => changeSaleParticipants(db, scope, payload('c3', 's2')),
  { code: 'SALE_CHANGED' },
);
const audit = JSON.parse(
  String(
    adapter.database.prepare('SELECT details_json FROM audit_events').get()!
      .details_json,
  ),
);
assert.equal(audit.before.customerName, 'Cliente Um');
assert.equal(audit.after.sellerName, 'Vendedor Dois');
assert.deepEqual(
  {
    ...adapter.database
      .prepare(
        'SELECT products_total_cents,received_total_cents FROM sales WHERE id=?',
      )
      .get('sale'),
  },
  { products_total_cents: 500000, received_total_cents: 300000 },
);
const race = await Promise.allSettled([
  changeSaleParticipants(db, scope, payload('c1', 's1', first.current)),
  changeSaleParticipants(db, scope, payload('c3', 's1', first.current)),
]);
assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
assert.equal(race.filter((r) => r.status === 'rejected').length, 1);
assert.equal(count(), 2);
const afterRace = await readSaleParticipants(db, 'a', 'sale');
assert.equal(afterRace.revision, 2);
// Same identity after a round trip still rejects an old editor (ABA protection).
await changeSaleParticipants(db, scope, payload('c2', 's2', afterRace));
await assert.rejects(
  () => changeSaleParticipants(db, scope, payload('c3', 's1', first.current)),
  { code: 'SALE_CHANGED' },
);
const afterAba = await readSaleParticipants(db, 'a', 'sale');
const auditCount = count();
// Replaying an old successful operation never overwrites a newer correction.
assert.equal(
  (await changeSaleParticipants(db, scope, firstInput)).current.revision,
  afterAba.revision,
);
assert.equal(count(), auditCount);
const batch = adapter.batch.bind(adapter);
adapter.batch = async (statements) => {
  adapter.database.prepare('UPDATE clients SET active=0 WHERE id=?').run('c3');
  return batch(statements);
};
await assert.rejects(
  () => changeSaleParticipants(db, scope, payload('c3', 's1', afterAba)),
  { code: 'SALE_CHANGED' },
);
assert.equal(count(), auditCount);
assert.deepEqual(await readSaleParticipants(db, 'a', 'sale'), afterAba);
adapter.batch = batch;
const noop = payload(afterAba.customerId, afterAba.sellerUserId, afterAba);
await changeSaleParticipants(db, scope, noop);
assert.equal((await changeSaleParticipants(db, scope, noop)).replayed, true);
assert.equal(count(), auditCount + 1);
await assert.rejects(
  () => changeSaleParticipants(db, scope, { ...noop, customerId: 'c1' }),
  { code: 'OPERATION_ALREADY_USED' },
);
adapter.database.exec("UPDATE sales SET status='cancelled' WHERE id='sale'");
await assert.rejects(
  () => changeSaleParticipants(db, scope, payload('c1', 's1', afterAba)),
  { code: 'SALE_CANCELLED' },
);
assert.equal(count(), auditCount + 1);
assert.equal(can({ role: 'operator' }, 'sales.participants'), false);
assert.equal(
  can(
    { role: 'operator', permissions: ['sales', 'sales.participants'] },
    'sales.participants',
  ),
  true,
);
assert.equal(
  can(
    { role: 'operator', permissions: ['sales.participants'] },
    'sales.participants',
  ),
  false,
);
adapter.close();
console.log(
  'PASS: participant edits, scoped active choices, no financial mutation, audit, replay, stale/ABA conflicts, concurrent edits, transactional deactivation, cancellations and permissions.',
);
