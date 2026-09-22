import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import {
  createReservation,
  changeReservation,
  listReservations,
  validateReservationSale,
  convertReservationStatement,
  inventoryStatusSql,
} from '../lib/server/reservations.ts';
import { can, resolvePermissions } from '../lib/permissions.ts';
import { routePermissions } from '../lib/server/permissions.ts';
const adapter = new SqliteDatabase(':memory:');
const raw = adapter.database,
  db = adapter as unknown as D1Database;
raw.exec(`CREATE TABLE stores(id TEXT PRIMARY KEY);
CREATE TABLE users(id TEXT PRIMARY KEY,store_id TEXT,display_name TEXT);
CREATE TABLE clients(id TEXT PRIMARY KEY,store_id TEXT,name TEXT,active INTEGER);
CREATE TABLE products(id TEXT PRIMARY KEY,store_id TEXT,model TEXT,color TEXT,memory TEXT,default_price_cents INTEGER);
CREATE TABLE sales(id TEXT PRIMARY KEY,store_id TEXT,number INTEGER);
CREATE TABLE inventory_units(id TEXT PRIMARY KEY,store_id TEXT,product_id TEXT,serial TEXT,status TEXT,sale_id TEXT);
CREATE TABLE audit_events(id TEXT PRIMARY KEY,store_id TEXT,actor_user_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT NOT NULL,details_json TEXT,created_at INTEGER);
INSERT INTO stores VALUES('shop'),('other');
INSERT INTO users VALUES('actor','shop','Operador'),('outsider','other','Outra loja');
INSERT INTO clients VALUES('customer','shop','Cliente Teste',1),('foreign','other','Cliente secreto',1);
INSERT INTO products VALUES('product','shop','iPhone teste','Preto','256 GB',500000);
INSERT INTO inventory_units VALUES('unit','shop','product','RESERVA0001','available',NULL),('unit2','shop','product','RESERVA0002','available',NULL),('foreign-unit','other','product','RESERVA9999','available',NULL);
INSERT INTO sales VALUES('sale','shop',1);`);
raw.exec(readFileSync('drizzle/0018_stock_reservations.sql', 'utf8'));
const input = (unitIds = ['unit']) => ({
  operationId: crypto.randomUUID(),
  customerId: 'customer',
  unitIds,
  expiresAt: Date.now() + 86400000,
  notes: 'Separar para teste',
});
const status = (id = 'unit') =>
  raw
    .prepare(
      `SELECT ${inventoryStatusSql()} AS status FROM inventory_units iu WHERE iu.id=?`,
    )
    .get(id)!.status;
const first = input();
await createReservation(db, 'shop', 'actor', first);
assert.equal(status(), 'reserved');
assert.equal(
  (await createReservation(db, 'shop', 'actor', first)).replayed,
  true,
);
await assert.rejects(
  createReservation(db, 'shop', 'actor', { ...first, notes: 'Outra coisa' }),
  /outra reserva/,
);
await assert.rejects(
  createReservation(db, 'shop', 'actor', input()),
  /estoque mudou/,
);
await assert.rejects(
  createReservation(db, 'shop', 'actor', input(['foreign-unit'])),
  /estoque mudou/,
);
await assert.rejects(
  createReservation(db, 'shop', 'actor', {
    ...input(['unit2']),
    customerId: 'foreign',
  }),
  /Cliente ativo/,
);
assert.equal(
  raw.prepare('SELECT COUNT(*) AS n FROM stock_reservations').get()!.n,
  1,
);
assert.throws(
  () =>
    raw
      .prepare(
        "UPDATE inventory_units SET status='sold',sale_id='sale' WHERE id='unit'",
      )
      .run(),
  /RESERVATION_UNIT_UNAVAILABLE/,
);
assert.equal(status(), 'reserved');
assert.equal(
  (
    await listReservations(
      db,
      'other',
      new URL('https://test/api/reservations?status=all'),
    )
  ).items.length,
  0,
);
const list = await listReservations(
  db,
  'shop',
  new URL('https://test/api/reservations?status=active&q=RESERVA0001'),
);
assert.equal(list.items[0].items[0].serial, 'RESERVA0001');
assert.doesNotMatch(JSON.stringify(list), /fingerprint|Cliente secreto/);
await assert.rejects(
  changeReservation(db, 'other', 'outsider', first.operationId, {
    action: 'release',
    revision: 0,
  }),
  /não encontrada/,
);
await changeReservation(db, 'shop', 'actor', first.operationId, {
  action: 'deadline',
  expiresAt: Date.now() + 172800000,
  revision: 0,
});
await assert.rejects(
  changeReservation(db, 'shop', 'actor', first.operationId, {
    action: 'release',
    revision: 0,
  }),
  /mudou/,
);
await changeReservation(db, 'shop', 'actor', first.operationId, {
  action: 'release',
  revision: 1,
});
assert.equal(status(), 'available');
// A two-item claim is all-or-nothing, including the audit record.
const held = input(['unit2']);
await createReservation(db, 'shop', 'actor', held);
await assert.rejects(
  createReservation(db, 'shop', 'actor', input(['unit', 'unit2'])),
  /estoque mudou/,
);
assert.equal(status(), 'available');
assert.equal(
  raw.prepare('SELECT COUNT(*) AS n FROM stock_reservations').get()!.n,
  2,
);
// Time alone releases a hold; no cron, browser visit or destructive cleanup.
raw
  .prepare('UPDATE stock_reservations SET expires_at=? WHERE id=?')
  .run(Date.now() - 1000, held.operationId);
assert.equal(status('unit2'), 'available');
assert.equal(
  (
    await listReservations(
      db,
      'shop',
      new URL('https://test/api/reservations?status=expired'),
    )
  ).items.length,
  1,
);
await assert.rejects(
  validateReservationSale(db, 'shop', held.operationId, 'customer', ['unit2']),
  /venceu/,
);
const conversion = input();
await createReservation(db, 'shop', 'actor', conversion);
await assert.rejects(
  validateReservationSale(db, 'shop', conversion.operationId, 'customer', [
    'unit2',
  ]),
  /correspondem/,
);
const revision = await validateReservationSale(
  db,
  'shop',
  conversion.operationId,
  'customer',
  ['unit'],
);
// A failure after conversion rolls back both the reservation and inventory.
await assert.rejects(
  db.batch([
    convertReservationStatement(
      db,
      'shop',
      conversion.operationId,
      'sale',
      revision,
    ),
    db.prepare(
      "UPDATE inventory_units SET status='sold',sale_id='sale' WHERE id='unit'",
    ),
    db.prepare('INSERT INTO nonexistent VALUES(1)'),
  ]),
);
assert.equal(status(), 'reserved');
await db.batch([
  convertReservationStatement(
    db,
    'shop',
    conversion.operationId,
    'sale',
    revision,
  ),
  db.prepare(
    "UPDATE inventory_units SET status='sold',sale_id='sale' WHERE id='unit'",
  ),
]);
assert.equal(status(), 'sold');
assert.equal(
  (
    await listReservations(
      db,
      'shop',
      new URL('https://test/api/reservations?status=converted'),
    )
  ).items[0].saleId,
  'sale',
);
await assert.rejects(
  validateReservationSale(db, 'shop', conversion.operationId, 'customer', [
    'unit',
  ]),
  /venceu/,
);
assert.deepEqual(
  routePermissions(new Request('https://test/api/reservations')),
  ['reservations'],
);
assert.deepEqual(
  routePermissions(
    new Request('https://test/api/reservations/id', { method: 'PATCH' }),
  ),
  ['reservations.manage'],
);
assert.equal(
  can(
    { role: 'operator', permissions: ['reservations'] },
    'reservations.manage',
  ),
  false,
);
assert.equal(
  can(
    {
      role: 'operator',
      permissions: resolvePermissions('operator', '["reservations.manage"]'),
    },
    'reservations.manage',
  ),
  false,
);
adapter.close();
console.log(
  'Reservations passed: exclusive stock, same-store access, expiry, release, optimistic concurrency, idempotency, atomic conversion/rollback, no sales or payments on hold creation.',
);
