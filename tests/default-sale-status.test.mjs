import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';

function register(db, label = 'principal') {
  const session = db.register({
    name: `Responsável ${label}`,
    store_name: `Loja ${label}`,
    email: `${label}-${randomUUID()}@example.test`,
    password: 'senha-ficticia-de-teste'
  });
  return db.actor(session.token);
}

function completeSale(db, actor, reviewManual) {
  const customer = db.addCustomer(actor, { name: 'Cliente' });
  const product = db.addProduct(actor, { name: 'Produto', price_cents: 1_000 });
  db.receive(actor, { product_id: product.id, quantity: 2, unit_cost_cents: 400 });
  const draft = db.saveDraft(actor, {
    customer_id: customer.id,
    seller_id: actor.id,
    ...(reviewManual === undefined ? {} : { review_manual: reviewManual }),
    items: [{ product_id: product.id, quantity: 1, unit_price_cents: 1_000 }]
  });
  db.addPayment(actor, draft.id, { method: 'cash', amount_cents: 1_000, request_id: randomUUID() });
  db.confirm(actor, draft.id, false, db.sale(actor, draft.id).draft_token);
  return draft.id;
}

test('loja nova recebe Conciliado uma vez, isolado e protegido contra renomeação', t => {
  const db = new Store();
  t.after(() => db.close());
  const first = register(db, 'primeira');
  const second = register(db, 'segunda');
  const firstStatus = db.snapshot(first).sale_statuses.filter(status => status.name === 'Conciliado');
  const secondStatus = db.snapshot(second).sale_statuses.filter(status => status.name === 'Conciliado');

  assert.equal(firstStatus.length, 1);
  assert.equal(secondStatus.length, 1);
  assert.notEqual(firstStatus[0].id, secondStatus[0].id);
  assert.equal(firstStatus[0].color, 'green');
  assert.throws(() => db.saveSaleStatus(first, { name: 'Finalizado' }, firstStatus[0].id),
    error => error.status === 409 && /não pode ser renomeado/.test(error.message));
  assert.throws(() => db.scoped('sale_statuses', firstStatus[0].id, second), error => error.status === 404);
});

test('venda nova nasce A conferir e Conciliado encerra a conferência em uma alteração atômica', t => {
  const db = new Store();
  t.after(() => db.close());
  const actor = register(db);
  const saleId = completeSale(db, actor);
  let sale = db.sale(actor, saleId);

  assert.deepEqual(sale.review, { manual: true, automatic: false, required: true, reasons: [] });
  const reconciled = db.snapshot(actor).sale_statuses.find(status => status.name === 'Conciliado');
  sale = db.setOperationalStatus(actor, saleId, {
    operational_status_id: reconciled.id,
    review_manual: false,
    edit_token: sale.edit_token
  });

  assert.equal(sale.operational_status_id, reconciled.id);
  assert.equal(sale.operational_status.name, 'Conciliado');
  assert.equal(sale.is_reconciled, true);
  assert.deepEqual(sale.review, { manual: false, automatic: false, required: false, reasons: [] });
  assert.equal(db.get('SELECT review_manual FROM sales WHERE tenant_id=? AND id=?', actor.tenant_id, saleId).review_manual, 0);
  assert.equal(db.get(`SELECT COUNT(*) AS count FROM audit
    WHERE tenant_id=? AND entity='sale' AND entity_id=? AND action='review_manual_changed'`,
  actor.tenant_id, saleId).count, 1);

  sale = db.setOperationalStatus(actor, saleId, {
    operational_status_id: null,
    review_manual: true,
    edit_token: sale.edit_token
  });
  assert.equal(sale.operational_status_id, null);
  assert.equal(sale.is_reconciled, false);
  assert.equal(sale.review.required, true);
});

test('Conciliado retira A conferir mesmo após divergência assumida pelo responsável', t => {
  const db = new Store();
  t.after(() => db.close());
  const actor = register(db, 'divergencia');
  const customer = db.addCustomer(actor, { name: 'Cliente' });
  const product = db.addProduct(actor, { name: 'Produto', price_cents: 1_000 });
  db.receive(actor, { product_id: product.id, quantity: 1, unit_cost_cents: 300 });
  const draft = db.saveDraft(actor, {
    customer_id: customer.id, seller_id: actor.id,
    items: [{ product_id: product.id, quantity: 1, unit_price_cents: 1_000 }]
  });
  db.addPayment(actor, draft.id, { method: 'cash', amount_cents: 700, request_id: randomUUID() });
  db.confirm(actor, draft.id, true, db.sale(actor, draft.id).draft_token);
  let sale = db.sale(actor, draft.id);
  assert.deepEqual(sale.review.reasons, ['payment_mismatch']);
  const reconciled = db.snapshot(actor).sale_statuses.find(status => status.name === 'Conciliado');

  sale = db.setOperationalStatus(actor, draft.id, {
    operational_status_id: reconciled.id, review_manual: false, edit_token: sale.edit_token
  });
  assert.equal(sale.is_reconciled, true);
  assert.deepEqual(sale.review, { manual: false, automatic: false, required: false, reasons: [] });
  assert.equal(sale.reconciliation.state, 'underpaid', 'o status não falsifica os valores financeiros');
});

test('migração adiciona somente Conciliado às lojas antigas e a segunda abertura é idempotente', t => {
  const directory = mkdtempSync(join(tmpdir(), 'pdv-reconciled-status-'));
  const path = join(directory, 'legacy.sqlite');
  let db = new Store(path);
  t.after(() => { db?.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); });
  const actor = register(db, 'legada');
  const saleId = completeSale(db, actor, false);
  const tenant = db.get('SELECT id,created_at FROM tenants WHERE id=?', actor.tenant_id);
  const defaultId = db.get('SELECT id FROM sale_statuses WHERE tenant_id=? AND name=? COLLATE NOCASE', actor.tenant_id, 'Conciliado').id;
  db.run('DELETE FROM sale_statuses WHERE tenant_id=? AND id=?', actor.tenant_id, defaultId);
  const legacyStatusId = randomUUID();
  db.run('INSERT INTO sale_statuses(id,tenant_id,name,color,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    legacyStatusId, actor.tenant_id, 'CONCILIADO', 'purple', tenant.created_at, tenant.created_at);
  db.close(); db = null;

  db = new Store(path);
  let rows = db.all('SELECT id,name,color,created_at,updated_at FROM sale_statuses WHERE tenant_id=? AND name=? COLLATE NOCASE',
    actor.tenant_id, 'Conciliado').map(row => ({ ...row }));
  assert.deepEqual(rows, [{ id: legacyStatusId, name: 'CONCILIADO', color: 'purple', created_at: tenant.created_at, updated_at: tenant.created_at }]);
  assert.equal(db.get('SELECT review_manual FROM sales WHERE tenant_id=? AND id=?', actor.tenant_id, saleId).review_manual, 0,
    'a migração não deve reclassificar vendas antigas');
  db.close(); db = null;

  db = new Store(path);
  rows = db.all('SELECT id,name,color,created_at,updated_at FROM sale_statuses WHERE tenant_id=? AND name=? COLLATE NOCASE',
    actor.tenant_id, 'Conciliado').map(row => ({ ...row }));
  assert.deepEqual(rows, [{ id: legacyStatusId, name: 'CONCILIADO', color: 'purple', created_at: tenant.created_at, updated_at: tenant.created_at }]);
  assert.equal(db.all('PRAGMA foreign_key_check').length, 0);
});

test('cadastro principal por Google também recebe o status padrão', t => {
  const db = new Store();
  t.after(() => db.close());
  const session = db.googleLogin({
    sub: `google-${randomUUID()}`,
    email: `google-${randomUUID()}@example.test`,
    name: 'Responsável Google'
  }, 'Loja Google');
  const actor = db.actor(session.token);
  assert.deepEqual(db.snapshot(actor).sale_statuses.map(status => status.name), ['Conciliado']);
});

test('HTTP entrega Conciliado e mantém A conferir como padrão da nova venda', async t => {
  const store = new Store(), origin = 'http://127.0.0.1:3999';
  const { server } = application({ store, origin });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(`${base}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      name: 'Responsável HTTP', store_name: 'Loja HTTP',
      email: `status-http-${randomUUID()}@example.test`, password: 'senha-ficticia-de-teste'
    })
  });
  assert.equal(response.status, 201);
  const headers = {
    'Content-Type': 'application/json', Origin: origin,
    Cookie: response.headers.get('set-cookie').split(';')[0]
  };
  response = await fetch(`${base}/api/state`, { headers });
  assert.equal(response.status, 200);
  const reconciled = (await response.json()).sale_statuses.find(status => status.name === 'Conciliado');
  assert.ok(reconciled);

  response = await fetch(`${base}/api/sales`, {
    method: 'POST', headers, body: JSON.stringify({ items: [] })
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  response = await fetch(`${base}/api/sales/${created.id}`, { headers });
  assert.equal(response.status, 200);
  const sale = await response.json();
  assert.equal(sale.review.required, true);
  assert.equal(sale.review.manual, true);

  response = await fetch(`${base}/api/sales/${created.id}/status`, {
    method: 'PUT', headers,
    body: JSON.stringify({ operational_status_id: reconciled.id, review_manual: false, edit_token: sale.edit_token })
  });
  assert.equal(response.status, 200);
  const finalized = await response.json();
  assert.equal(finalized.operational_status.name, 'Conciliado');
  assert.equal(finalized.is_reconciled, true);
  assert.equal(finalized.review.required, false);
});
