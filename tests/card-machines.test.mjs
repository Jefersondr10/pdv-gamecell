import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';

function setup(t) {
  const db = new Store(); t.after(() => db.close());
  const registration = db.register({ name: 'A', store_name: 'Máquinas teste', email: 'machine@example.test', password: 'senha-de-teste-123' });
  return { db, actor: db.actor(registration.token) };
}
const table = () => ({ name: 'Máquina de teste', brands: [
  { name: 'Visa / Mastercard', debit_basis_points: 200, credit_rates: [{ installments: 1, basis_points: 300 }, { installments: 18, basis_points: 1800 }] },
  { name: 'Outras Bandeiras', debit_basis_points: 250, credit_rates: [{ installments: 1, basis_points: 400 }] }
] });

test('máquina agrupa bandeiras e taxas, preserva IDs e fotografia ao editar ou remover parcelas', t => {
  const { db, actor } = setup(t), machine = db.saveCardMachine(actor, table());
  let state = db.snapshot(actor), catalog = state.card_machines[0];
  assert.equal(catalog.id, machine.id); assert.equal(catalog.brands.length, 2); assert.equal(state.rates.length, 5);
  const visa = catalog.brands.find(brand => brand.name === 'Visa / Mastercard');
  const firstRate = state.rates.find(rate => rate.brand_id === visa.id && rate.mode === 'credit' && rate.installments === 1);
  const oldDebit = state.rates.find(rate => rate.brand_id === visa.id && rate.mode === 'debit');
  const sale = db.saveDraft(actor, { items: [] });
  const requestId = randomUUID(), payload = { request_id: requestId, method: 'card', amount_cents: 10000, rate_id: firstRate.id };
  const recorded = db.addPayment(actor, sale.id, payload), paymentBefore = { ...db.get('SELECT * FROM payments WHERE id=?', recorded.id) };

  db.saveCardMachine(actor, { name: 'Máquina do balcão', brands: [{ id: visa.id, name: 'Visa e Master',
    debit_basis_points: null, credit_rates: [{ installments: 1, basis_points: 500 }, { installments: 36, basis_points: 2000 }] }] }, machine.id);
  state = db.snapshot(actor); assert.equal(state.card_machines.length, 1); assert.equal(state.card_machines[0].brands.length, 1);
  assert.equal(state.rates.length, 2); assert.equal(state.rates.find(rate => rate.installments === 1).id, firstRate.id);
  assert.equal(state.rates[0].machine, 'Máquina do balcão'); assert.equal(state.rates[0].brand, 'Visa e Master');
  assert.equal(db.get('SELECT active FROM rates WHERE id=?', oldDebit.id).active, 0);
  assert.deepEqual({ ...db.get('SELECT * FROM payments WHERE id=?', recorded.id) }, paymentBefore);
  assert.equal(db.addPayment(actor, sale.id, payload).id, recorded.id);
  assert.throws(() => db.addPayment(actor, sale.id, { ...payload, request_id: randomUUID(), rate_id: oldDebit.id }), /inativa/);
  const newPayment = db.addPayment(actor, sale.id, { ...payload, request_id: randomUUID() });
  assert.equal(db.get('SELECT fee_cents FROM payments WHERE id=?', newPayment.id).fee_cents, 500);
  db.saveCardMachine(actor, { name: 'Máquina do balcão', brands: [{ id: visa.id, name: 'Visa e Master', debit_basis_points: 210, credit_rates: [] }] }, machine.id);
  assert.equal(db.snapshot(actor).rates[0].id, oldDebit.id);
  assert.equal(db.all('PRAGMA foreign_key_check').length, 0);
});

test('cadastro de máquina é atômico, valida duplicidades e mantém compatibilidade das taxas individuais', t => {
  const { db, actor } = setup(t), machine = db.saveCardMachine(actor, table());
  const before = JSON.stringify(db.snapshot(actor).card_machines), beforeRates = JSON.stringify(db.snapshot(actor).rates);
  for (const invalid of [
    { name: 'Alterado', brands: [{ name: 'V', debit_basis_points: 10, credit_rates: [{ installments: 1, basis_points: 3 }, { installments: 1, basis_points: 4 }] }] },
    { name: 'Alterado', brands: [{ name: 'V', credit_rates: [] }, { name: 'v', credit_rates: [] }] },
    { name: 'Alterado', brands: [{ name: 'V', credit_rates: [{ installments: 37, basis_points: 3 }] }] },
    { name: 'Alterado', brands: [{ name: 'V', debit_basis_points: '199', credit_rates: [] }] },
    { name: 'Alterado', brands: [{ name: 'V', credit_rates: [{ installments: 1, basis_points: 10001 }] }] }
  ]) assert.throws(() => db.saveCardMachine(actor, invalid, machine.id));
  assert.equal(JSON.stringify(db.snapshot(actor).card_machines), before);
  assert.equal(JSON.stringify(db.snapshot(actor).rates), beforeRates);
  const beforeCount = db.all('SELECT * FROM card_machines').length;
  assert.throws(() => db.saveRate(actor, { machine: 'Máquina de teste', brand: 'Outras Bandeiras', mode: 'debit', installments: 1, basis_points: 500 }), /Já existe/);
  assert.equal(db.all('SELECT * FROM card_machines').length, beforeCount);
  const legacy = db.saveRate(actor, { machine: 'Máquina compatível', brand: 'Elo', mode: 'credit', installments: 2, basis_points: 600 });
  assert.ok(db.snapshot(actor).rates.find(rate => rate.id === legacy.id).machine_id);
  const empty = db.saveCardMachine(actor, { name: 'Máquina vazia', brands: [] });
  assert.deepEqual(db.snapshot(actor).card_machines.find(row => row.id === empty.id).brands, []);
});

test('máquinas e bandeiras respeitam loja, vínculos e permissões', t => {
  const { db, actor } = setup(t), own = db.saveCardMachine(actor, table());
  const other = db.actor(db.register({ name: 'B', store_name: 'Outra loja', email: 'other-machine@example.test', password: 'senha-de-teste-123' }).token);
  const theirs = db.saveCardMachine(other, table()), foreignBrand = db.snapshot(other).card_machines[0].brands[0];
  assert.throws(() => db.saveCardMachine(actor, table(), theirs.id), /não encontrado/);
  assert.throws(() => db.saveCardMachine(actor, { name: 'Inválido', brands: [{ id: foreignBrand.id, name: 'V', credit_rates: [] }] }, own.id), /não encontrado/);
  const second = db.saveCardMachine(actor, { name: 'Segunda', brands: [{ name: 'Elo', credit_rates: [] }] });
  const wrongBrand = db.snapshot(actor).card_machines.find(row => row.id === second.id).brands[0];
  assert.throws(() => db.saveCardMachine(actor, { name: 'Inválido', brands: [{ id: wrongBrand.id, name: 'V', credit_rates: [] }] }, own.id), /não pertence/);
  db.addUser(actor, { name: 'V', email: 'seller-machine@example.test', password: 'senha-de-teste-123', permissions: [] });
  const seller = db.actor(db.login({ email: 'seller-machine@example.test', password: 'senha-de-teste-123' }).token);
  assert.throws(() => db.saveCardMachine(seller, table()), /permitido/);
  assert.ok(db.snapshot(seller).rates.every(rate => !('basis_points' in rate)));
  const rate = db.snapshot(actor).rates[0];
  assert.throws(() => db.run('UPDATE rates SET brand_id=? WHERE id=?', foreignBrand.id, rate.id), /invalid card/);
  assert.equal(db.snapshot(other).card_machines.length, 1);
});

test('falha em taxa legada ambígua reverte máquina, marcas, taxas e auditoria na mesma transação', t => {
  const { db, actor } = setup(t), machine = db.saveCardMachine(actor, table());
  const state = db.snapshot(actor), other = state.rates.find(rate => rate.brand === 'Outras Bandeiras' && rate.mode === 'credit');
  db.run(`INSERT INTO rates(id,tenant_id,machine,brand,machine_id,brand_id,mode,installments,basis_points,active,created_at)
    SELECT ?,tenant_id,machine,brand,machine_id,brand_id,mode,installments,999,active,created_at FROM rates WHERE id=?`, randomUUID(), other.id);
  const before = JSON.stringify(db.snapshot(actor)), auditCount = db.all('SELECT id FROM audit').length;
  const replacement = table(); replacement.name = 'Alteração que deve voltar';
  replacement.brands[0].debit_basis_points = 100;
  assert.throws(() => db.saveCardMachine(actor, replacement, machine.id), /duplicadas/);
  assert.equal(JSON.stringify(db.snapshot(actor)), before);
  assert.equal(db.all('SELECT id FROM audit').length, auditCount);
  assert.ok(db.all('SELECT name FROM card_brands').every(brand => !brand.name.startsWith('__editing_')));
});

test('paleta aceita qualquer hexadecimal seguro e preserva cores legadas', t => {
  const { db, actor } = setup(t);
  const status = db.saveSaleStatus(actor, { name: 'Personalizado', color: '#a1b2c3' });
  assert.equal(status.color, '#A1B2C3');
  assert.equal(db.saveSaleStatus(actor, { name: 'Legado', color: 'amber' }).color, 'amber');
  for (const color of ['#fff', '#12345g', 'transparent', 'red;display:none', '#12345678', 'url(x)', '#123456"']) {
    assert.throws(() => db.saveSaleStatus(actor, { name: 'Inválido', color }), /Cor.*inválida/);
  }
  assert.throws(() => db.run('UPDATE sale_statuses SET color=? WHERE id=?', '#GGGGGG', status.id), /CHECK/);
});

test('CPF opcional normaliza sem unicidade, protege o compartilhamento e números rejeitam letras', t => {
  const { db, actor } = setup(t);
  assert.equal(db.addCustomer(actor, { name: 'Sem CPF' }).cpf, '');
  assert.equal(db.addCustomer(actor, { name: 'Vazio', cpf: '   ' }).cpf, '');
  const customer = db.addCustomer(actor, { name: 'Com CPF', cpf: '529.982.247-25' });
  assert.equal(customer.cpf, '52998224725');
  assert.equal(db.addCustomer(actor, { name: 'Mesmo CPF', cpf: customer.cpf }).cpf, customer.cpf);
  for (const cpf of ['11111111111', '52998224726', '123', 'abc52998224725', '...']) {
    assert.throws(() => db.addCustomer(actor, { name: 'Inválido', cpf }), /CPF inválido/);
  }
  assert.equal(db.snapshot(actor).customers.find(row => row.id === customer.id).cpf, customer.cpf);
  const sale = db.saveDraft(actor, { customer_id: customer.id, items: [] });
  assert.ok(!JSON.stringify(db.public(db.share(actor, sale.id).token)).includes(customer.cpf));
  const other = db.actor(db.register({ name: 'B', store_name: 'B', email: 'cpf-other@example.test', password: 'senha-de-teste-123' }).token);
  assert.equal(db.snapshot(other).customers.length, 0);
  const product = db.addProduct(actor, { name: 'P', price_cents: 100 });
  assert.throws(() => db.receive(actor, { product_id: product.id, quantity: 1, unit_cost_cents: '10x' }), /inteiro/);
  assert.throws(() => db.saveDraft(actor, { items: [{ product_id: product.id, quantity: '1x', unit_price_cents: 100 }] }), /inteiro/);
});

test('migração reúne taxas legadas e libera cores sem perder status, clientes ou pagamentos', t => {
  const dir = mkdtempSync(join(tmpdir(), 'pdv-machine-migration-')); let db;
  t.after(() => { db?.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); });
  const dbPath = join(dir, 'legacy.sqlite'); db = new Store(dbPath);
  const registration = db.register({ name: 'A', store_name: 'Legada', email: 'legacy-machine@example.test', password: 'senha-de-teste-123' });
  let actor = db.actor(registration.token);
  const customer = db.addCustomer(actor, { name: 'Cliente preservado' });
  const sale = db.saveDraft(actor, { customer_id: customer.id, items: [] });
  const rate = db.saveRate(actor, { machine: 'Máquina não identificada (prints)', brand: 'Visa', mode: 'credit', installments: 1, basis_points: 300 });
  const requestId = randomUUID();
  const recorded = db.addPayment(actor, sale.id, { request_id: requestId, method: 'card', amount_cents: 10000, rate_id: rate.id });
  const paymentBefore = { ...db.get('SELECT * FROM payments WHERE id=?', recorded.id) };
  const status = db.saveSaleStatus(actor, { name: 'Em separação', color: 'blue' });
  db.setOperationalStatus(actor, sale.id, { operational_status_id: status.id });
  db.db.exec(`PRAGMA foreign_keys=OFF;
    CREATE TABLE rates_legacy (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,machine TEXT NOT NULL,brand TEXT NOT NULL,
      mode TEXT NOT NULL,installments INTEGER NOT NULL,basis_points INTEGER NOT NULL,active INTEGER NOT NULL,created_at TEXT NOT NULL,UNIQUE(tenant_id,id));
    INSERT INTO rates_legacy SELECT id,tenant_id,machine,brand,mode,installments,basis_points,active,created_at FROM rates;
    DROP TABLE rates; ALTER TABLE rates_legacy RENAME TO rates; DROP TABLE card_brands; DROP TABLE card_machines;
    CREATE TABLE statuses_legacy (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),name TEXT NOT NULL COLLATE NOCASE,
      color TEXT NOT NULL DEFAULT 'neutral' CHECK(color IN ('neutral','blue','green','amber','red','purple')),
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(tenant_id,id),UNIQUE(tenant_id,name));
    INSERT INTO statuses_legacy SELECT * FROM sale_statuses; DROP TABLE sale_statuses; ALTER TABLE statuses_legacy RENAME TO sale_statuses;
    CREATE TABLE customers_legacy (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(tenant_id,id));
    INSERT INTO customers_legacy SELECT id,tenant_id,name,email,phone,created_at FROM customers;
    DROP TABLE customers; ALTER TABLE customers_legacy RENAME TO customers; PRAGMA foreign_keys=ON;`);
  db.close(); db = null;
  db = new Store(dbPath); actor = db.actor(registration.token);
  const state = db.snapshot(actor), machine = state.card_machines[0];
  assert.equal(state.rates[0].id, rate.id); assert.equal(state.rates[0].machine_id, machine.id);
  assert.equal(state.customers[0].id, customer.id); assert.equal(state.customers[0].cpf, '');
  assert.equal(db.sale(actor, sale.id).operational_status_id, status.id);
  db.saveSaleStatus(actor, { color: '#008899' }, status.id);
  assert.equal(db.sale(actor, sale.id).operational_status.color, '#008899');
  db.saveCardMachine(actor, { name: 'Máquina de teste', brands: [{ id: machine.brands[0].id, name: 'Visa',
    debit_basis_points: 200, credit_rates: [{ installments: 1, basis_points: 300 }] }] }, machine.id);
  assert.deepEqual({ ...db.get('SELECT * FROM payments WHERE id=?', recorded.id) }, paymentBefore);
  assert.equal(db.all('PRAGMA foreign_key_check').length, 0);
  db.close(); db = new Store(dbPath); actor = db.actor(registration.token);
  assert.equal(db.snapshot(actor).card_machines[0].id, machine.id);
  assert.equal(db.snapshot(actor).rates.find(row => row.mode === 'credit').id, rate.id);
});

test('HTTP: cadastro agrupado de máquina, cor personalizada e CPF opcional persistem pelo contrato público', async t => {
  const store = new Store(), origin = 'http://127.0.0.1:3999';
  const { server } = application({ store, origin });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ name: 'A', store_name: 'HTTP Máquinas', email: 'http-machine@example.test', password: 'senha-de-teste-123' }) });
  assert.equal(response.status, 201);
  const headers = { 'Content-Type': 'application/json', Origin: origin, Cookie: response.headers.get('set-cookie').split(';')[0] };
  response = await fetch(`${base}/api/card-machines`, { method: 'POST', headers, body: JSON.stringify(table()) });
  assert.equal(response.status, 201); const machineId = (await response.json()).id;
  let state = await (await fetch(`${base}/api/state`, { headers })).json();
  assert.equal(state.card_machines[0].id, machineId);
  assert.equal(state.rates.length, 5); assert.ok(state.rates.every(rate => rate.machine_id === machineId && rate.brand_id));
  const replacement = table(); replacement.name = 'Pagbank editado';
  replacement.brands = replacement.brands.map(brand => ({ ...brand, id: state.card_machines[0].brands.find(row => row.name === brand.name).id }));
  response = await fetch(`${base}/api/card-machines/${machineId}`, { method: 'PUT', headers, body: JSON.stringify(replacement) });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/sale-statuses`, { method: 'POST', headers, body: JSON.stringify({ name: 'Personalizado HTTP', color: '#f08ca1' }) });
  assert.equal(response.status, 201); assert.equal((await response.json()).color, '#F08CA1');
  response = await fetch(`${base}/api/customers`, { method: 'POST', headers, body: JSON.stringify({ name: 'Cliente HTTP', cpf: '529.982.247-25' }) });
  assert.equal(response.status, 201); assert.equal((await response.json()).cpf, '52998224725');
  response = await fetch(`${base}/api/customers`, { method: 'POST', headers, body: JSON.stringify({ name: 'Inválido HTTP', cpf: '11111111111' }) });
  assert.equal(response.status, 400);
  state = await (await fetch(`${base}/api/state`, { headers })).json();
  assert.equal(state.card_machines[0].name, 'Pagbank editado');
  assert.equal(state.customers[0].cpf, '52998224725');
  assert.equal(state.sale_statuses[0].color, '#F08CA1');
});
