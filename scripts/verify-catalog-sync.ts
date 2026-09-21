import assert from 'node:assert/strict';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import {
  syncSystemCatalog,
  canonicalProductVariationKey,
} from '../lib/server/system-catalog-sync.ts';
import {
  SYSTEM_CATALOG_PRODUCTS,
  SYSTEM_CATALOG_VERSION,
} from '../lib/system-catalog.ts';
import { normalizeCommercialCode } from '../lib/gtin.ts';

const adapter = new SqliteDatabase(':memory:');
const db = adapter as unknown as D1Database;
adapter.database.exec(`
  CREATE TABLE products (id TEXT PRIMARY KEY, store_id TEXT, model TEXT, color TEXT,
    memory TEXT, default_price_cents INTEGER, active INTEGER, created_by TEXT,
    created_at INTEGER, updated_at INTEGER, UNIQUE(store_id, model, color, memory));
  CREATE TABLE product_codes (id TEXT PRIMARY KEY, store_id TEXT, product_id TEXT,
    code TEXT, kind TEXT, market TEXT, created_at INTEGER, UNIQUE(store_id, code));
  CREATE TABLE system_catalog_syncs (store_id TEXT PRIMARY KEY, catalog_version INTEGER, synced_at INTEGER);
  CREATE TABLE audit_events (id TEXT PRIMARY KEY, store_id TEXT, actor_user_id TEXT,
    action TEXT, entity_type TEXT, entity_id TEXT, details_json TEXT, created_at INTEGER);
  CREATE TABLE inventory_units (id TEXT PRIMARY KEY, product_id TEXT, serial TEXT, status TEXT);
  INSERT INTO products VALUES ('existing', 'shop', 'iPhone 18 Pro', 'Glacier', '256GB', 999900, 0, 'owner', 1, 1);
  INSERT INTO products VALUES ('foreign', 'other', 'iPhone 18 Pro', 'Glacial', '256 GB', 123, 1, 'other', 1, 1);
  INSERT INTO inventory_units VALUES ('unit', 'existing', 'REAL-SN-KEEP', 'sold');
`);

const savedBefore = adapter.database
  .prepare('SELECT * FROM products ORDER BY id')
  .all();
const inventoryBefore = adapter.database
  .prepare('SELECT * FROM inventory_units')
  .all();
const source = SYSTEM_CATALOG_PRODUCTS.find(
  (product) =>
    product.model === 'iPhone 18 Pro' &&
    product.color === 'Glacial' &&
    product.memory === '256 GB',
)!;
assert.equal(
  canonicalProductVariationKey(source),
  canonicalProductVariationKey({
    model: 'iPhone 18 Pro',
    color: 'Glacier',
    memory: '256GB',
  }),
);
assert.equal(
  canonicalProductVariationKey({
    model: 'iPhone 18 Pro',
    color: 'Burgundy',
    memory: '2TB',
  }),
  canonicalProductVariationKey({
    model: 'iPhone 18 Pro',
    color: 'Bordô',
    memory: '2 TB',
  }),
);

const first = await syncSystemCatalog(db, 'shop', 'owner');
assert.equal(first.productsAdded, SYSTEM_CATALOG_PRODUCTS.length - 1);
assert.equal(first.codesAdded, 392);
assert.equal(first.conflictsSkipped, 0);
assert.deepEqual(
  adapter.database
    .prepare(
      "SELECT * FROM products WHERE id IN ('existing', 'foreign') ORDER BY id",
    )
    .all(),
  savedBefore,
);
assert.deepEqual(
  adapter.database.prepare('SELECT * FROM inventory_units').all(),
  inventoryBefore,
);
for (const code of source.codes) {
  assert.equal(
    adapter.database
      .prepare(
        'SELECT product_id FROM product_codes WHERE store_id=? AND code=?',
      )
      .get('shop', normalizeCommercialCode(code.value))!.product_id,
    'existing',
  );
}
assert.equal(
  adapter.database
    .prepare(
      'SELECT catalog_version FROM system_catalog_syncs WHERE store_id=?',
    )
    .get('shop')!.catalog_version,
  SYSTEM_CATALOG_VERSION,
);

const second = await syncSystemCatalog(db, 'shop', 'owner');
assert.equal(second.productsAdded, 0);
assert.equal(second.codesAdded, 0);
assert.equal(second.codesUpdated, 0);
assert.equal(
  adapter.database
    .prepare('SELECT COUNT(*) AS n FROM products WHERE store_id=?')
    .get('shop')!.n,
  148,
);

// Never move a user's existing code to a different product during synchronization.
const preservedCode = normalizeCommercialCode(source.codes[0].value);
adapter.database
  .prepare('UPDATE product_codes SET product_id=? WHERE store_id=? AND code=?')
  .run('foreign', 'shop', preservedCode);
const conflict = await syncSystemCatalog(db, 'shop', 'owner');
assert.ok(conflict.conflictsSkipped >= 1);
assert.equal(
  adapter.database
    .prepare('SELECT product_id FROM product_codes WHERE store_id=? AND code=?')
    .get('shop', preservedCode)!.product_id,
  'foreign',
);
adapter.close();
console.log(
  'Catalog sync passed: additions, aliases, idempotency, conflict protection, prices and stock preserved.',
);
