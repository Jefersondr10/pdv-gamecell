import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';
import { businessDate } from '../src/domain.mjs';

function setup(t) {
  const db = new Store();
  t.after(() => db.close());
  const auth = db.register({
    name: 'Responsável de teste', store_name: 'Loja de conferência',
    email: `review-${randomUUID()}@example.test`, password: 'senha-ficticia-de-teste'
  });
  const actor = db.actor(auth.token);
  const customer = db.addCustomer(actor, { name: 'Cliente de teste' });
  const product = db.addProduct(actor, { name: 'Produto de teste', sku: 'REV-1', price_cents: 1000 });
  db.receive(actor, { product_id: product.id, quantity: 20, unit_cost_cents: 250 });
  return { db, actor, token: auth.token, customer, product };
}

function dayBefore(day) {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function createSale(x, options = {}) {
  const price = options.price ?? 1000;
  const items = options.items ?? [{ product_id: options.product_id ?? x.product.id, quantity: 1, unit_price_cents: price }];
  const payload = {
    customer_id: options.customer_id ?? x.customer.id,
    seller_id: options.seller_id ?? x.actor.id,
    business_date: options.business_date ?? businessDate(),
    is_wholesale: options.is_wholesale ?? false,
    items
  };
  if (options.review_manual !== undefined) payload.review_manual = options.review_manual;
  const id = x.db.saveDraft(x.actor, payload).id;
  const paid = options.paid === undefined ? price : options.paid;
  if (paid > 0) x.db.addPayment(x.actor, id, { method: 'cash', amount_cents: paid, request_id: randomUUID() });
  if (options.confirmed !== false) x.db.confirm(x.actor, id, true);
  return id;
}

function editableItems(sale) {
  return sale.items.map(item => ({
    id: item.id, product_id: item.product_id, description: item.description,
    quantity: item.quantity, unit_price_cents: item.unit_price_cents,
    unit_ids: item.unit_ids ?? [], serial_number: item.serial_number ?? '',
    details: item.details ?? '', share_details: !!item.share_details
  }));
}

test('conferência: pagamento, custo e marca manual formam uma única pendência dinâmica', t => {
  const x = setup(t);
  const complete = createSale(x);
  const underpaid = createSale(x, { paid: 400 });
  const noStock = x.db.addProduct(x.actor, { name: 'Produto sem entrada', price_cents: 1000 });
  const twoReasons = createSale(x, { product_id: noStock.id, paid: 0 });

  assert.deepEqual(x.db.sale(x.actor, complete).review, { manual: false, automatic: false, required: false, reasons: [] });
  assert.deepEqual(x.db.sale(x.actor, underpaid).review.reasons, ['payment_mismatch']);
  assert.deepEqual(x.db.sale(x.actor, twoReasons).review.reasons, ['payment_mismatch', 'pending_cost']);
  assert.equal(x.db.snapshot(x.actor).dashboard.incomplete_sales, 2);

  x.db.addPayment(x.actor, underpaid, { method: 'cash', amount_cents: 600, request_id: randomUUID() });
  assert.equal(x.db.sale(x.actor, underpaid).review.required, false);
  x.db.addPayment(x.actor, twoReasons, { method: 'cash', amount_cents: 1000, request_id: randomUUID() });
  assert.deepEqual(x.db.sale(x.actor, twoReasons).review.reasons, ['pending_cost']);
  x.db.receive(x.actor, { product_id: noStock.id, quantity: 1, unit_cost_cents: 300 });
  assert.equal(x.db.sale(x.actor, twoReasons).review.required, false);
  assert.equal(x.db.snapshot(x.actor).dashboard.incomplete_sales, 0);
});

test('conferência manual: é auditada, concorrente e não substitui status operacional', t => {
  const x = setup(t), id = createSale(x);
  const status = x.db.saveSaleStatus(x.actor, { name: 'Em separação', color: 'blue' });
  x.db.setOperationalStatus(x.actor, id, { operational_status_id: status.id });
  const original = x.db.sale(x.actor, id);
  const marked = x.db.setReviewManual(x.actor, id, { review_manual: true, edit_token: original.edit_token });
  assert.equal(marked.review.manual, true);
  assert.equal(marked.review.automatic, false);
  assert.equal(marked.review.required, true);
  assert.equal(marked.operational_status_id, status.id);
  assert.equal(x.db.snapshot(x.actor).dashboard.incomplete_sales, 1);

  const action = "entity='sale' AND entity_id=? AND action='review_manual_changed'";
  assert.equal(x.db.get(`SELECT COUNT(*) AS count FROM audit WHERE ${action}`, id).count, 1);
  const repeated = x.db.setReviewManual(x.actor, id, { review_manual: true, edit_token: marked.edit_token });
  assert.equal(x.db.get(`SELECT COUNT(*) AS count FROM audit WHERE ${action}`, id).count, 1);
  assert.throws(() => x.db.setReviewManual(x.actor, id, { review_manual: false, edit_token: original.edit_token }), /mudou em outra tela/);
  const cleared = x.db.setReviewManual(x.actor, id, { review_manual: false, edit_token: repeated.edit_token });
  assert.equal(cleared.review.required, false);
  assert.equal(cleared.operational_status_id, status.id);
  assert.equal(x.db.get(`SELECT COUNT(*) AS count FROM audit WHERE ${action}`, id).count, 2);
});

test('conferência manual: remover marca manual não encobre pendência automática', t => {
  const x = setup(t), id = createSale(x, { paid: 0 });
  let sale = x.db.sale(x.actor, id);
  sale = x.db.setReviewManual(x.actor, id, { review_manual: true, edit_token: sale.edit_token });
  assert.deepEqual(sale.review, { manual: true, automatic: true, required: true, reasons: ['payment_mismatch'] });
  sale = x.db.setReviewManual(x.actor, id, { review_manual: false, edit_token: sale.edit_token });
  assert.deepEqual(sale.review, { manual: false, automatic: true, required: true, reasons: ['payment_mismatch'] });
  x.db.addPayment(x.actor, id, { method: 'cash', amount_cents: 1000, request_id: randomUUID() });
  assert.equal(x.db.sale(x.actor, id).review.required, false);
});

test('rascunho e edição confirmada aceitam review_manual com permissão e preservam tokens', t => {
  const x = setup(t);
  const id = createSale(x, { confirmed: false, review_manual: true });
  let sale = x.db.sale(x.actor, id);
  assert.deepEqual(sale.review, { manual: true, automatic: false, required: false, reasons: [] });
  const staleDraftToken = sale.draft_token;
  sale = x.db.setReviewManual(x.actor, id, { review_manual: false, edit_token: sale.edit_token });
  assert.throws(() => x.db.saveDraft(x.actor, {
    customer_id: x.customer.id, seller_id: x.actor.id, items: editableItems(sale),
    review_manual: true, draft_token: staleDraftToken
  }, id), /mudou em outra tela/);
  x.db.saveDraft(x.actor, {
    customer_id: x.customer.id, seller_id: x.actor.id, items: editableItems(sale),
    review_manual: true, draft_token: sale.draft_token
  }, id);
  x.db.confirm(x.actor, id, false, x.db.sale(x.actor, id).draft_token);

  const confirmed = x.db.sale(x.actor, id);
  x.db.operations.editSale(x.actor, id, {
    customer_id: confirmed.customer_id, seller_id: confirmed.seller_id,
    business_date: confirmed.business_date, items: editableItems(confirmed), review_manual: false,
    edit_token: confirmed.edit_token, request_id: randomUUID(), reason: 'Conferência concluída'
  });
  assert.equal(x.db.sale(x.actor, id).review.manual, false);
});

test('review_manual informado sem sales.change_status é rejeitado, mesmo sem mudar o valor', t => {
  const x = setup(t);
  const user = x.db.addUser(x.actor, {
    name: 'Vendedor restrito', email: `restricted-${randomUUID()}@example.test`,
    password: 'senha-ficticia-de-teste', permissions: ['sales.edit_draft']
  });
  const restricted = x.db.actor(x.db.login({ email: user.email, password: 'senha-ficticia-de-teste' }).token);
  const id = createSale(x, { seller_id: user.id, confirmed: false });
  const sale = x.db.sale(restricted, id);
  const payload = { customer_id: x.customer.id, seller_id: user.id, items: editableItems(sale), draft_token: sale.draft_token };
  assert.throws(() => x.db.saveDraft(restricted, { ...payload, review_manual: false }, id), error => error.status === 403);
  assert.doesNotThrow(() => x.db.saveDraft(restricted, payload, id));
  assert.throws(() => x.db.setReviewManual(restricted, id, { review_manual: true, edit_token: sale.edit_token }), error => error.status === 403);
});

test('filtro de conferência combina data e atacado e mantém lista e dashboard coerentes', t => {
  const x = setup(t), today = businessDate(), yesterday = dayBefore(today);
  const automatic = createSale(x, { business_date: today, is_wholesale: false, paid: 0 });
  const manual = createSale(x, { business_date: yesterday, is_wholesale: true });
  const manualSale = x.db.sale(x.actor, manual);
  x.db.setReviewManual(x.actor, manual, { review_manual: true, edit_token: manualSale.edit_token });
  const clear = createSale(x, { business_date: today, is_wholesale: true });

  let state = x.db.snapshot(x.actor, { review: 'required', from: today, to: today, sale_type: 'retail' });
  assert.deepEqual(state.sales.map(s => s.id), [automatic]);
  assert.equal(state.dashboard.sales_count, 1);
  assert.equal(state.dashboard.incomplete_sales, 1);
  state = x.db.snapshot(x.actor, { review: 'required', from: yesterday, to: yesterday, sale_type: 'wholesale' });
  assert.deepEqual(state.sales.map(s => s.id), [manual]);
  assert.equal(state.dashboard.incomplete_sales, 1);
  state = x.db.snapshot(x.actor, { review: 'clear', from: today, to: today, sale_type: 'wholesale' });
  assert.deepEqual(state.sales.map(s => s.id), [clear]);
  assert.equal(state.dashboard.incomplete_sales, 0);
  assert.throws(() => x.db.snapshot(x.actor, { review: 'pending' }), /conferência inválido/);
});

test('dados obrigatórios legados seguros geram razões sem inventar pendência em opcionais', t => {
  const x = setup(t), id = createSale(x);
  x.db.run("UPDATE sales SET customer_id=NULL,seller_id=NULL,business_date='data-antiga-inválida' WHERE id=?", id);
  let sale = x.db.sale(x.actor, id);
  assert.ok(sale.review.reasons.includes('missing_customer'));
  assert.ok(sale.review.reasons.includes('missing_seller'));
  assert.ok(sale.review.reasons.includes('missing_business_date'));

  const empty = createSale(x, { items: [{ description: 'Avulso', quantity: 1, unit_price_cents: 1000, manual_cost_cents: 200 }] });
  x.db.run('DELETE FROM sale_items WHERE tenant_id=? AND sale_id=?', x.actor.tenant_id, empty);
  sale = x.db.sale(x.actor, empty);
  assert.ok(sale.review.reasons.includes('missing_items'));

  const optional = createSale(x, { items: [{ description: 'Serviço avulso', quantity: 1, unit_price_cents: 0, manual_cost_cents: 0 }], paid: 0 });
  assert.equal(x.db.sale(x.actor, optional).review.required, false);
});

test('pagamentos legados sem fotografia e data válida entram em conferência', t => {
  const x = setup(t);
  const pix = createSale(x), card = createSale(x);
  x.db.db.exec('DROP TRIGGER trg_payments_pix_catalog_update');
  x.db.run("UPDATE payments SET method='pix',created_at='data-inválida' WHERE sale_id=?", pix);
  x.db.run("UPDATE payments SET method='card' WHERE sale_id=?", card);
  assert.deepEqual(x.db.sale(x.actor, pix).review.reasons, ['missing_pix_account', 'missing_payment_date']);
  assert.deepEqual(x.db.sale(x.actor, card).review.reasons, ['missing_card_details']);
});

test('SN obrigatório é derivado somente de item historicamente rastreado', t => {
  const x = setup(t);
  const tracked = x.db.addProduct(x.actor, { name: 'Console rastreado', price_cents: 1000, serial_tracked: true });
  x.db.operations.receive(x.actor, {
    product_id: tracked.id, units: [{ serial_number: 'SN-REV-001', unit_cost_cents: 250 }], request_id: randomUUID()
  });
  const unit = x.db.serials.units(x.actor, tracked.id)[0];
  const trackedSale = createSale(x, { product_id: tracked.id, items: [{ product_id: tracked.id, quantity: 1, unit_price_cents: 1000, unit_ids: [unit.id] }] });
  assert.equal(x.db.sale(x.actor, trackedSale).review.required, false);
  x.db.run('DELETE FROM sale_item_units WHERE tenant_id=? AND item_id=?', x.actor.tenant_id, x.db.sale(x.actor, trackedSale).items[0].id);
  assert.ok(x.db.sale(x.actor, trackedSale).review.reasons.includes('missing_serials'));

  const historical = createSale(x);
  x.db.run('UPDATE products SET serial_tracked=1 WHERE tenant_id=? AND id=?', x.actor.tenant_id, x.product.id);
  assert.equal(x.db.sale(x.actor, historical).items[0].tracks_serials, undefined);
  assert.equal(x.db.sale(x.actor, historical).review.required, false);
});

test('cancelada nunca fica em conferência e marcador interno não é exposto no pedido público', t => {
  const x = setup(t), id = createSale(x);
  let sale = x.db.sale(x.actor, id);
  sale = x.db.setReviewManual(x.actor, id, { review_manual: true, edit_token: sale.edit_token });
  const link = x.db.share(x.actor, id);
  const publicJson = JSON.stringify(x.db.public(link.token));
  assert.ok(!publicJson.includes('review'));
  x.db.operations.cancelSale(x.actor, id, {
    edit_token: sale.edit_token, request_id: randomUUID(), reason: 'Cancelamento de teste',
    acknowledge_stock_return: true, acknowledge_refund_pending: true
  });
  const cancelled = x.db.sale(x.actor, id);
  assert.deepEqual(cancelled.review, { manual: true, automatic: false, required: false, reasons: [] });
  assert.equal(x.db.snapshot(x.actor).dashboard.incomplete_sales, 0);
  assert.throws(() => x.db.setReviewManual(x.actor, id, { review_manual: false, edit_token: cancelled.edit_token }), /cancelada/);
});

test('marcação manual não transforma fechamento financeiro completo em pendência', t => {
  const x = setup(t), id = createSale(x);
  const sale = x.db.sale(x.actor, id);
  x.db.setReviewManual(x.actor, id, { review_manual: true, edit_token: sale.edit_token });
  assert.equal(x.db.finance.calculate(x.actor, businessDate().slice(0, 7)).incomplete_sales.length, 0);
});

test('migração aditiva cria review_manual com zero e CHECK sem perder a venda', t => {
  const dir = mkdtempSync(join(tmpdir(), 'pdv-review-'));
  const path = join(dir, 'legacy.sqlite');
  let db = new Store(path);
  const auth = db.register({ name: 'Pessoa', store_name: 'Loja antiga', email: 'legacy-review@example.test', password: 'senha-ficticia-de-teste' });
  const actor = db.actor(auth.token), id = db.saveDraft(actor, { items: [] }).id;
  db.close();
  const legacy = new DatabaseSync(path);
  legacy.exec('PRAGMA foreign_keys=OFF; ALTER TABLE sales DROP COLUMN review_manual;');
  legacy.close();
  db = new Store(path);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.ok(db.all('PRAGMA table_info(sales)').some(column => column.name === 'review_manual'));
  assert.equal(db.get('SELECT review_manual FROM sales WHERE id=?', id).review_manual, 0);
  assert.throws(() => db.run('UPDATE sales SET review_manual=2 WHERE id=?', id), /CHECK/);
});

test('HTTP review exige sessão, origem, permissão, booleano e token atual', async t => {
  const x = setup(t), id = createSale(x), origin = 'http://127.0.0.1';
  const { server } = application({ store: x.db, origin });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Cookie: `pdv_session=${x.token}`, Origin: origin, 'Content-Type': 'application/json' };
  const call = (data, customHeaders = headers) => fetch(`${base}/api/sales/${id}/review`, { method: 'PUT', headers: customHeaders, body: JSON.stringify(data) });
  const sale = x.db.sale(x.actor, id);
  assert.equal((await call({ review_manual: true, edit_token: sale.edit_token }, { ...headers, Cookie: '' })).status, 401);
  assert.equal((await call({ review_manual: true, edit_token: sale.edit_token }, { ...headers, Origin: 'https://other.example' })).status, 403);
  assert.equal((await call({ review_manual: 'true', edit_token: sale.edit_token })).status, 400);
  assert.equal((await call({ review_manual: true })).status, 409);
  const response = await call({ review_manual: true, edit_token: sale.edit_token });
  assert.equal(response.status, 200);
  const marked = await response.json();
  assert.equal(marked.review.required, true);
  assert.equal((await call({ review_manual: false, edit_token: sale.edit_token })).status, 409);

  const restricted = x.db.addUser(x.actor, {
    name: 'Sem permissão', email: `http-review-${randomUUID()}@example.test`, password: 'senha-ficticia-de-teste', permissions: []
  });
  const login = x.db.login({ email: restricted.email, password: 'senha-ficticia-de-teste' });
  assert.equal((await call({ review_manual: false, edit_token: marked.edit_token }, {
    ...headers, Cookie: `pdv_session=${login.token}`, 'X-PDV-User': restricted.id
  })).status, 403);
});
