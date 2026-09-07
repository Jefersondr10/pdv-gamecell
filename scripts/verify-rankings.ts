import assert from 'node:assert/strict';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import { readRanking } from '../lib/server/rankings.ts';

const db = new SqliteDatabase(':memory:');
const now = new Date('2026-09-05T12:00:00-03:00').getTime();
db.database.exec(`
  CREATE TABLE sales (id TEXT, store_id TEXT, customer_id TEXT, customer_name TEXT, seller_user_id TEXT, seller_name TEXT, created_at INTEGER, status TEXT);
  CREATE TABLE sale_items (id TEXT, store_id TEXT, sale_id TEXT, product_id TEXT, product_name TEXT, sold_price_cents INTEGER);
  CREATE TABLE clients (id TEXT, store_id TEXT, name TEXT);
  CREATE TABLE users (id TEXT, store_id TEXT, display_name TEXT);
  CREATE TABLE products (id TEXT, store_id TEXT, model TEXT, color TEXT, memory TEXT);
`);
const sale = db.database.prepare(
  'INSERT INTO sales VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
);
const item = db.database.prepare(
  'INSERT INTO sale_items VALUES (?, ?, ?, ?, ?, ?)',
);
const client = db.database.prepare('INSERT INTO clients VALUES (?, ?, ?)');
const product = db.database.prepare(
  'INSERT INTO products VALUES (?, ?, ?, ?, ?)',
);
client.run('c1', 'a', 'Nome atual');
client.run('c2', 'a', 'Homônimo');
client.run('c3', 'a', 'Homônimo');
client.run('c4', 'a', '100%_Apple');
client.run('foreign', 'b', 'Nome atual');
db.database
  .prepare('INSERT INTO users VALUES (?, ?, ?)')
  .run('seller', 'a', 'Vendedor atual');
product.run('p1', 'a', 'iPhone 17', 'Azul', '256 GB');
product.run('p2', 'a', 'iPhone 17', 'Azul', '512 GB');
sale.run(
  's1',
  'a',
  'c1',
  'Nome antigo',
  'seller',
  'Vendedor antigo',
  now,
  'completed',
);
item.run('i1', 'a', 's1', 'p1', 'Nome antigo produto', 1000);
item.run('i2', 'a', 's1', 'p1', 'iPhone 17', 2000);
item.run('i3', 'a', 's1', 'p2', 'iPhone 17', 5000);
sale.run('s2', 'a', 'c2', 'Homônimo', 'seller', 'Vendedor', now, 'completed');
item.run('i4', 'a', 's2', 'p2', 'iPhone 17', 9000);
sale.run('s3', 'a', 'c3', 'Homônimo', 'seller', 'Vendedor', now, 'completed');
item.run('i5', 'a', 's3', 'p2', 'iPhone 17', 0);
sale.run(
  'cancel',
  'a',
  'c1',
  'Nome antigo',
  'seller',
  'Vendedor',
  now,
  'cancelled',
);
item.run('cancel-i', 'a', 'cancel', 'p1', 'iPhone 17', 9999999);
sale.run(
  'other',
  'b',
  'foreign',
  'Nome atual',
  'seller-b',
  'Vendedor B',
  now,
  'completed',
);
item.run('other-i', 'b', 'other', 'p1', 'iPhone 17', 9999999);
sale.run(
  'old',
  'a',
  'c4',
  '100%_Apple',
  'seller',
  'Vendedor',
  now - 86400000,
  'completed',
);
item.run('old-i', 'a', 'old', 'p1', 'iPhone 17', 10);

const read = (q: string, store = 'a') =>
  readRanking(
    db as unknown as D1Database,
    new URL(`https://example.test/api/rankings?period=day&day=2026-09-05&${q}`),
    store,
  );
try {
  const customers = await read('dimension=customer');
  assert.deepEqual(customers.totals, {
    participants: 3,
    itemCount: 5,
    amountCents: 17000,
  });
  assert.equal(customers.items[0].key, 'c1');
  assert.equal(customers.items[0].saleCount, 1);
  assert.equal(customers.items[0].label, 'Nome atual');
  assert.deepEqual(
    customers.items.map((row) => row.position),
    [1, 2, 2],
  );
  assert.equal(
    customers.items.filter((row) => row.label === 'Homônimo').length,
    2,
  );
  assert.equal(
    (await read('dimension=customer&order=value')).items[0].key,
    'c2',
  );
  assert.equal(
    (await read('dimension=customer&q=Homônimo')).items[0].position,
    2,
  );
  assert.equal((await read('dimension=customer&q=Vendedor')).items.length, 0);
  assert.equal(
    (await read('dimension=customer&q=' + encodeURIComponent("' OR 1=1 --")))
      .items.length,
    0,
  );
  const allLiteral = await readRanking(
    db as unknown as D1Database,
    new URL(
      'https://example.test/api/rankings?period=all&dimension=customer&q=%25_',
    ),
    'a',
  );
  assert.equal(allLiteral.items.length, 1);
  assert.equal(allLiteral.items[0].key, 'c4');
  const products = await read('dimension=product');
  assert.equal(products.items.length, 2);
  assert.equal(products.items[0].key, 'p2');
  assert.equal(products.items[0].memory, '512 GB');
  assert.equal(products.items[1].memory, '256 GB');
  assert.equal(products.items[1].saleCount, 1);
  assert.equal(products.items[1].itemCount, 2);
  assert.equal(products.items[1].totalCents, 3000);
  assert.equal((await read('dimension=seller')).items[0].saleCount, 3);
  assert.equal(
    (await read('dimension=seller')).items[0].label,
    'Vendedor atual',
  );
  assert.equal((await read('dimension=customer', 'b')).items[0].key, 'foreign');
  assert.equal((await read('dimension=customer', 'empty')).items.length, 0);
  await assert.rejects(read('dimension=invalid'));
  await assert.rejects(read('order=invalid'));
  await assert.rejects(read('offset=-1'));
  await assert.rejects(read('offset=NaN'));
  for (let index = 0; index < 121; index++) {
    const id = `page-${index}`;
    client.run(id, 'pages', id);
    sale.run(id, 'pages', id, id, 'seller', 'Seller', now, 'completed');
    item.run(id, 'pages', id, 'p1', 'Phone', index);
  }
  const pages = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = await read(`dimension=customer&offset=${offset}`, 'pages');
    pages.push(...page.items);
    offset = page.nextOffset;
    assert.equal(page.totals.participants, 121);
  }
  assert.equal(pages.length, 121);
  assert.equal(new Set(pages.map((row) => row.key)).size, 121);
  assert.ok(pages.every((row) => row.position === 1));
  console.log(
    'Rankings: variants, homonyms, changed names, cancellations, totals, ties, periods, literal search, pagination and tenant isolation passed.',
  );
} finally {
  db.close();
}
