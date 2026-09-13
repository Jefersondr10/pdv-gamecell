import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import { loadEntryHistoryPages } from '../lib/entry-history-refresh.ts';

// Exercise the real PATCH handlers against an isolated, in-memory transaction adapter.
const root = resolve(import.meta.dirname, '..');
const adapter = new SqliteDatabase(':memory:');
const session = {
  id: 'owner',
  role: 'owner',
  storeId: 'store',
  storeCode: 'TEST',
};
const overrides = new Map([
  [
    resolve(root, 'lib/server/runtime.ts'),
    {
      runtime: () => ({ DB: adapter }),
      requiredSecret: () => 'fixture-secret-only',
    },
  ],
  [
    resolve(root, 'lib/server/auth.ts'),
    {
      requireSession: async () => session,
      assertCsrf: () => {},
    },
  ],
  [
    resolve(root, 'lib/server/rate-limit.ts'),
    {
      consumeStoreWriteBudget: async () => {},
      consumeControlWriteBudget: async () => {},
    },
  ],
]);
const modules = new Map();
function load(relative) {
  let path = resolve(root, relative);
  if (!existsSync(path)) path += '.ts';
  if (overrides.has(path)) return overrides.get(path);
  if (modules.has(path)) return modules.get(path).exports;
  const compiledModule = { exports: {} };
  modules.set(path, compiledModule);
  const result = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  });
  vm.runInNewContext(
    result.outputText,
    {
      module: compiledModule,
      exports: compiledModule.exports,
      require: (name) =>
        load(
          name.startsWith('@/') ? name.slice(2) : resolve(dirname(path), name),
        ),
      Request,
      Response,
      Headers,
      URL,
      TextEncoder,
      TextDecoder,
      ReadableStream,
      crypto,
      btoa,
      atob,
      console,
      Error,
      Date,
      Uint8Array,
      ArrayBuffer,
    },
    { filename: path },
  );
  return compiledModule.exports;
}
adapter.database.exec(`
  CREATE TABLE products(id TEXT PRIMARY KEY, store_id TEXT, model TEXT, color TEXT, memory TEXT, default_price_cents INTEGER, active INTEGER, updated_at INTEGER);
  CREATE TABLE product_codes(id TEXT PRIMARY KEY,store_id TEXT,product_id TEXT,code TEXT,kind TEXT,market TEXT,created_at INTEGER,UNIQUE(store_id,code));
  CREATE TABLE clients(id TEXT PRIMARY KEY,store_id TEXT,name TEXT,name_key TEXT,phone TEXT,email TEXT,notes TEXT,active INTEGER,created_at INTEGER,updated_at INTEGER);
  CREATE TABLE audit_events(id TEXT PRIMARY KEY,store_id TEXT,actor_user_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT NOT NULL,details_json TEXT,created_at INTEGER);
  CREATE TABLE users(id TEXT PRIMARY KEY,store_id TEXT,role TEXT,auth_kind TEXT,username_normalized TEXT,active INTEGER,permissions_json TEXT,updated_at INTEGER,password_hash TEXT,password_salt TEXT,password_iterations INTEGER,must_change_password INTEGER,session_version INTEGER);
  CREATE TABLE sessions(user_id TEXT);
  CREATE TABLE login_attempts(key_hash TEXT PRIMARY KEY,blocked_until INTEGER);
  INSERT INTO products VALUES('p','store','iPhone 16','Preto','128 GB',450000,1,1);
  INSERT INTO clients VALUES('c','store','Cliente','cliente','111',NULL,NULL,1,1,1);
  INSERT INTO users VALUES('staff','store','operator','password','staff',1,NULL,1,'old','salt',1,0,1);
  INSERT INTO sessions VALUES('staff');
`);
const product = load('app/api/products/[id]/route.ts');
const client = load('app/api/clients/[id]/route.ts');
async function patch(route, id, body) {
  const response = await route.PATCH(
    new Request('https://fixture.local/api/test', {
      method: 'PATCH',
      headers: {
        origin: 'https://fixture.local',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}
const price = () =>
  adapter.database
    .prepare('SELECT default_price_cents AS price FROM products WHERE id=?')
    .get('p').price;
const auditCount = () =>
  adapter.database.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
assert.equal(
  (await patch(product, 'p', { defaultPriceCents: 460000 })).status,
  409,
);
assert.equal(price(), 450000);
assert.equal(auditCount(), 0);
const newPrice = {
  defaultPriceCents: 470000,
  expected: { defaultPriceCents: 450000 },
};
assert.equal((await patch(product, 'p', newPrice)).status, 200);
assert.equal(
  (await patch(product, 'p', { color: 'Azul', expected: { color: 'Preto' } }))
    .status,
  200,
);
assert.equal(
  price(),
  470000,
  'metadata edit must preserve a concurrently updated price',
);
assert.equal(
  (await patch(product, 'p', newPrice)).status,
  200,
  'identical retry is safe',
);
const auditsBeforeConflict = auditCount();
const rejected = await patch(product, 'p', {
  defaultPriceCents: 480000,
  expected: { defaultPriceCents: 450000 },
  addCode: { code: '4006381333931', market: 'Brasil' },
});
assert.equal(rejected.status, 409);
assert.equal(rejected.body.code, 'CATALOG_CHANGED');
assert.equal(price(), 470000);
assert.equal(auditCount(), auditsBeforeConflict);
assert.equal(
  adapter.database.prepare('SELECT COUNT(*) AS n FROM product_codes').get().n,
  0,
  'conflict must not partially insert a UPC',
);
assert.equal(
  (await patch(product, 'p', { addCode: { code: '4006381333931' } })).status,
  200,
);
assert.equal((await patch(product, 'p', { active: false })).status, 200);
assert.equal((await patch(product, 'p', { active: true })).status, 200);
assert.equal(
  (
    await patch(product, 'p', {
      defaultPriceCents: 480000,
      expected: { defaultPriceCents: null },
    })
  ).status,
  409,
);

assert.equal((await patch(client, 'c', { phone: '222' })).status, 409);
assert.equal(
  (await patch(client, 'c', { phone: '222', expected: { phone: '111' } }))
    .status,
  200,
);
assert.equal(
  (await patch(client, 'c', { notes: 'Nota', expected: { notes: null } }))
    .status,
  200,
);
assert.equal(
  adapter.database.prepare('SELECT phone FROM clients WHERE id=?').get('c')
    .phone,
  '222',
);
const beforeClientConflict = auditCount();
assert.equal(
  (
    await patch(client, 'c', {
      phone: '333',
      notes: 'Não salvar',
      expected: { phone: '111', notes: 'Nota' },
    })
  ).status,
  409,
);
assert.equal(
  auditCount(),
  beforeClientConflict,
  'a rejected edit must not record a success audit',
);
assert.equal(
  adapter.database.prepare('SELECT notes FROM clients WHERE id=?').get('c')
    .notes,
  'Nota',
);
assert.equal((await patch(client, 'c', { active: false })).status, 200);
assert.equal((await patch(client, 'c', { active: true })).status, 200);
assert.equal(
  (await patch(client, 'c', { phone: null, expected: { phone: '222' } }))
    .status,
  200,
);

// Simulate a different terminal changing the guarded value immediately before BEGIN.
const originalBatch = adapter.batch.bind(adapter);
let raced = false;
adapter.batch = async (statements) => {
  if (!raced) {
    raced = true;
    adapter.database
      .prepare('UPDATE products SET default_price_cents=490000 WHERE id=?')
      .run('p');
  }
  return originalBatch(statements);
};
assert.equal(
  (
    await patch(product, 'p', {
      defaultPriceCents: 480000,
      expected: { defaultPriceCents: 470000 },
      addCode: { code: '5901234123457' },
    })
  ).status,
  409,
);
assert.equal(price(), 490000);
assert.equal(
  adapter.database.prepare('SELECT COUNT(*) AS n FROM product_codes').get().n,
  1,
);
adapter.batch = originalBatch;

const security = load('lib/server/security.ts');
const key = await security.credentialLoginAttemptKey('TEST', 'staff');
const originKey = await security.hmac(
  'origin\u0000fixture',
  'fixture-secret-only',
);
adapter.database
  .prepare('INSERT INTO login_attempts VALUES(?,?)')
  .run(key, Date.now() + 900000);
adapter.database
  .prepare('INSERT INTO login_attempts VALUES(?,?)')
  .run(originKey, Date.now() + 900000);
// Keep crypto-key generation real; password stretching itself is covered separately.
overrides.set(resolve(root, 'lib/server/security.ts'), {
  ...security,
  hashPassword: async () => ({
    hash: 'new',
    salt: 'new-salt',
    iterations: 600000,
  }),
});
const reset = load('app/api/users/[id]/route.ts');
assert.equal(
  (await patch(reset, 'staff', { password: 'NovaSenha12345' })).status,
  200,
);
assert.equal(
  adapter.database
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE key_hash=?')
    .get(key).n,
  0,
);
assert.equal(
  adapter.database
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE key_hash=?')
    .get(originKey).n,
  1,
);
assert.equal(
  adapter.database
    .prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?')
    .get('staff').n,
  0,
);
assert.match(
  readFileSync(resolve(root, 'app/api/auth/login/route.ts'), 'utf8'),
  /credentialLoginAttemptKey\(storeCode, login\)/,
);
adapter.close();

const entryPage = (start, end, nextCursor) => ({
  items: Array.from({ length: end - start }, (_, i) => ({
    id: String(start + i),
  })),
  nextCursor,
  total: 120,
  aggregates: { entryCount: 120, unitCount: 120, photoCount: 120 },
});
const requested = [];
const fetchPage = async (cursor) => {
  requested.push(cursor);
  return cursor === null
    ? entryPage(0, 50, '50')
    : cursor === '50'
      ? entryPage(50, 100, '100')
      : entryPage(100, 120, null);
};
const refreshed = await loadEntryHistoryPages(fetchPage, 100);
assert.equal(refreshed.items.length, 100);
assert.equal(refreshed.nextCursor, '100');
assert.deepEqual(requested, [null, '50']);
assert.equal(
  (await loadEntryHistoryPages(fetchPage, 150)).items.length,
  120,
  'stop at the new end of history',
);
assert.equal(
  await loadEntryHistoryPages(fetchPage, 100, null, () => false),
  null,
  'ignore a stale filter response',
);
await assert.rejects(
  () => loadEntryHistoryPages(async () => entryPage(0, 0, 'repeat'), 100),
  /continuar/,
);
await assert.rejects(
  () =>
    loadEntryHistoryPages(async (cursor) => {
      if (cursor) throw new Error('offline');
      return entryPage(0, 50, '50');
    }, 100),
  /offline/,
  'partial refresh must not replace the loaded history',
);
const entrySource = readFileSync(
  resolve(root, 'components/pdv/views/entry-history-view.tsx'),
  'utf8',
);
assert.match(entrySource, /loadEntries\(null, false, true\)/);
assert.match(entrySource, /Math\.max\(50, loadedCountRef\.current\)/);
console.log(
  'Catalog PATCH CAS/atomicity, password-reset HMAC, and loaded entry-history refresh regressions passed.',
);
