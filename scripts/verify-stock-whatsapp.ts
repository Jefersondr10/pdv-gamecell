import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  buildStockWhatsAppMessage,
  stockColorEmoji,
  type StockOfferRow,
} from '../lib/stock-whatsapp.ts';

const row = (overrides: Partial<StockOfferRow> = {}): StockOfferRow => ({
  model: 'iPhone 17',
  color: 'Azul',
  memory: '256 GB',
  defaultPriceCents: 495_000,
  ...overrides,
});
const generatedAt = Date.UTC(2026, 8, 7, 15, 30);
const render = (rows: StockOfferRow[]) =>
  buildStockWhatsAppMessage({ rows, generatedAt }, 'Minha loja');
const message = render([
  row(),
  row({ color: 'Verde' }),
  row({ color: 'Preto' }),
  row({ color: 'Azul', memory: '256GB' }),
  row({ color: 'Lavanda', defaultPriceCents: 499_000 }),
  row({ color: 'Branco', defaultPriceCents: 499_000 }),
  row({ memory: '512 GB' }),
  row({ memory: '1 TB' }),
]);
const sections = message.split('\n\n');
assert.equal(
  sections.filter((section) => section.startsWith('*iPhone 17 · 256GB*'))
    .length,
  2,
);
const firstPrice = sections.find(
  (section) => section.includes('4.950,00') && section.includes('256GB'),
)!;
assert.match(firstPrice, /🔵 Azul · ⚫ Preto · 🟢 Verde/);
assert.equal((firstPrice.match(/Azul/g) ?? []).length, 1);
assert.doesNotMatch(firstPrice, /Lavanda|Branco/);
const secondPrice = sections.find((section) => section.includes('4.990,00'))!;
assert.match(secondPrice, /⚪ Branco · 🟣 Lavanda/);
assert.doesNotMatch(secondPrice, /Azul|Verde|Preto/);
assert.ok(message.indexOf('512GB') < message.indexOf('1TB'));
assert.match(message, /07\/09\/2026,? 12:30/);
assert.doesNotMatch(
  message,
  /unidades|quantidade|disponíveis|serial|SN|LL|HN|garantia|LACRADOS|99403/i,
);
const groupLink = 'https://chat.whatsapp.com/H9rpYRcvNncCs9sW4pccDf';
assert.equal(message.split(groupLink).length - 1, 1);
assert.ok(message.endsWith(`💬 *Grupo de atacado da loja*\n${groupLink}`));
assert.equal(render([]), '');
assert.match(render([row({ defaultPriceCents: 1 })]), /R\$ 0,01/);
for (const price of [0, -1, NaN, Infinity, 12.5]) {
  const unknown = render([row({ defaultPriceCents: price })]);
  assert.match(unknown, /Preço sob consulta/);
  assert.doesNotMatch(unknown, /R\$ 0,00|NaN|Infinity/);
}
for (const [color, emoji] of [
  ['Laranja', '🟠'],
  ['Lavender', '🟣'],
  ['Rosa', '🩷'],
  ['Titânio azul', '🔵'],
  ['Preto', '⚫'],
  ['Silver', '🩶'],
  ['Branco', '⚪'],
  ['Deserto', '🟤'],
  ['Cor exclusiva', '▫️'],
])
  assert.equal(stockColorEmoji(color), emoji);
assert.match(
  render([
    row({ model: 'iPhone*\n17', color: 'Azul\n*Oferta*', memory: '256 GB' }),
  ]),
  /\*iPhone 17 · 256GB\*/,
);
assert.doesNotMatch(render([row({ color: 'Azul\n*Oferta*' })]), /\n\*Oferta\*/);
const large = render(
  Array.from({ length: 150 }, (_, i) => row({ model: `Modelo ${i + 1}` })),
);
assert.match(large, /Modelo 150/);

// Execute the exact production offer statement against isolated synthetic data.
const source = await readFile(
  new URL('../app/api/inventory/route.ts', import.meta.url),
  'utf8',
);
const sql = source.match(
  /`(\s*SELECT p\.model, p\.color, p\.memory, p\.default_price_cents AS defaultPriceCents[\s\S]*?)`/,
)?.[1];
assert.ok(sql, 'Offer query must be covered by this test.');
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE products(id TEXT PRIMARY KEY,store_id TEXT,model TEXT,color TEXT,memory TEXT,default_price_cents INTEGER,active INTEGER);
CREATE TABLE inventory_units(id TEXT PRIMARY KEY,store_id TEXT,product_id TEXT,status TEXT);
CREATE INDEX idx_inventory_units_product_status ON inventory_units(product_id,status);`);
const addProduct = db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?)');
const addUnit = db.prepare('INSERT INTO inventory_units VALUES(?,?,?,?)');
for (let i = 0; i < 150; i++) {
  addProduct.run(`p${i}`, 'shop-a', `Model ${i}`, 'Preto', '256GB', 123_456, 1);
  addUnit.run(`u${i}`, 'shop-a', `p${i}`, 'available');
}
addUnit.run('second-unit', 'shop-a', 'p0', 'available');
for (const [id, store, active, status] of [
  ['sold', 'shop-a', 1, 'sold'],
  ['inactive', 'shop-a', 0, 'available'],
  ['empty', 'shop-a', 1, 'none'],
  ['foreign', 'shop-b', 1, 'available'],
  ['wrong-tenant-unit', 'shop-a', 1, 'available'],
] as const) {
  addProduct.run(id, store, id, 'Azul', '128GB', 0, active);
  if (status !== 'none')
    addUnit.run(id, id === 'wrong-tenant-unit' ? 'shop-b' : store, id, status);
}
const offers = db.prepare(sql).all('shop-a');
assert.equal(
  offers.length,
  151,
  'No pagination truncation, zero-stock, sold or cross-tenant rows; archived catalog with remaining stock is still included.',
);
assert.deepEqual(Object.keys(offers[0]).sort(), [
  'color',
  'defaultPriceCents',
  'memory',
  'model',
]);
db.prepare('UPDATE products SET default_price_cents=654321 WHERE id=?').run(
  'p0',
);
assert.equal(
  db
    .prepare(sql)
    .all('shop-a')
    .find((item) => item.model === 'Model 0')?.defaultPriceCents,
  654321,
);
assert.equal(db.prepare(sql).all('shop-b').length, 1);
db.close();
console.log(
  'WhatsApp stock grouping, exact prices, emojis, no quantities, complete inventory and tenant isolation passed.',
);
