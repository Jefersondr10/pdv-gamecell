import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';

function setup(t) {
  const db = new Store(); t.after(() => db.close());
  const actor = db.actor(db.register({ name: 'Vendedor Álvaro', store_name: 'Consulta teste', email: 'query@example.test', password: 'senha-ficticia-de-teste' }).token);
  const customer = db.addCustomer(actor, { name: 'José da Conceição' });
  const product = db.addProduct(actor, { name: 'Aparelho catálogo', sku: 'APL-AX', price_cents: 1000 });
  db.receive(actor, { product_id: product.id, quantity: 10, unit_cost_cents: 250 });
  return { db, actor, customer, product };
}
function sale(x, { wholesale = false, price = 1000, paid = price, confirmed = true, customer = x.customer.id, seller = x.actor.id, date = '2026-08-03', description = 'Edição especial', items } = {}) {
  const key = x.db.saveDraft(x.actor, { customer_id: customer, seller_id: seller, business_date: date, is_wholesale: wholesale,
    items: items ?? [{ product_id: x.product.id, description, quantity: 1, unit_price_cents: price }] }).id;
  if (paid) x.db.addPayment(x.actor, key, { method: 'cash', amount_cents: paid, request_id: randomUUID() });
  if (confirmed) x.db.confirm(x.actor, key, true);
  return key;
}
function cancel(x, key) {
  x.db.operations.cancelSale(x.actor, key, { edit_token: x.db.sale(x.actor, key).edit_token, request_id: randomUUID(), reason: 'Desistência de teste', acknowledge_stock_return: true, acknowledge_refund_pending: true });
}
const ids = rows => rows.map(row => row.id).sort();

test('consulta de vendas: atacado e varejo filtram os mesmos registros usados nos totais', t => {
  const x = setup(t), wholesale = sale(x, { wholesale: true }), retail = sale(x, { price: 2000, paid: 500 });
  const draft = sale(x, { wholesale: true, price: 4000, paid: 0, confirmed: false });
  const cancelled = sale(x, { wholesale: true, price: 3000 }); cancel(x, cancelled);
  const all = x.db.snapshot(x.actor), filtered = x.db.snapshot(x.actor, { sale_type: 'wholesale' });
  assert.deepEqual(ids(x.db.listSales(x.actor, { sale_type: 'all' })), ids(all.sales));
  assert.deepEqual(ids(filtered.sales), [wholesale, draft, cancelled].sort());
  assert.deepEqual(filtered.dashboard, { sales_count: 1, revenue_cents: 1000, gross_cents: 1000, pending_cents: 0, excess_cents: 0, incomplete_sales: 0, profit_cents: 750, fees_cents: 0 });
  const retailState = x.db.snapshot(x.actor, { sale_type: 'retail' });
  assert.deepEqual(ids(retailState.sales), [retail]);
  assert.equal(retailState.dashboard.revenue_cents, 2000); assert.equal(retailState.dashboard.pending_cents, 1500);
  assert.equal(all.dashboard.revenue_cents, 3000); assert.equal(all.dashboard.sales_count, 2);
  assert.deepEqual(retailState.refunds_pending, filtered.refunds_pending); assert.equal(filtered.refunds_pending.total_cents, 3000);
  assert.equal(x.db.snapshot(x.actor, { sale_type: 'wholesale', status: 'cancelled' }).dashboard.sales_count, 0);
});

test('consulta de vendas: busca número simples/com zeros/#, nomes sem acento, descrição e SKU sem duplicar', t => {
  const x = setup(t), first = sale(x), other = x.db.addCustomer(x.actor, { name: 'Maria' });
  sale(x, { customer: other.id, description: 'Outra mercadoria', price: 1500 });
  for (const q of ['1', '0001', '#0001', '# 0001', 'José', 'JOSE DA CONCEICAO', '  josé   da  conceição  ']) {
    assert.deepEqual(ids(x.db.listSales(x.actor, { q })), [first], q);
    assert.equal(x.db.snapshot(x.actor, { q }).dashboard.revenue_cents, 1000);
  }
  assert.deepEqual(ids(x.db.listSales(x.actor, { q: 'edicao especial' })), [first]);
  assert.equal(x.db.listSales(x.actor, { q: 'apl-ax' }).length, 2);
  assert.equal(x.db.listSales(x.actor, { q: 'aparelho catalogo' }).length, 2);
  assert.equal(x.db.listSales(x.actor, { q: 'alvaro' }).length, 2);
  const multi = sale(x, { paid: 2000, items: [1, 2].map(() => ({ product_id: x.product.id, quantity: 1, unit_price_cents: 1000 })) });
  assert.equal(x.db.listSales(x.actor, { q: 'APL-AX' }).filter(row => row.id === multi).length, 1);
  for (const q of ["' OR 1=1 --", '%', '_', 'inexistente']) {
    assert.deepEqual(x.db.listSales(x.actor, { q }), []); assert.equal(x.db.snapshot(x.actor, { q }).dashboard.revenue_cents, 0);
  }
  assert.equal(x.db.listSales(x.actor, { q: '   ' }).length, 3);
});

test('consulta de vendas: combina busca/tipo com datas, situação e status operacional', t => {
  const x = setup(t), matched = sale(x, { wholesale: true });
  sale(x, { wholesale: true, date: '2026-08-04' }); sale(x, { wholesale: false });
  const status = x.db.saveSaleStatus(x.actor, { name: 'Em separação', color: 'blue' });
  x.db.setOperationalStatus(x.actor, matched, { operational_status_id: status.id });
  const filters = { q: 'jose', sale_type: 'wholesale', from: '2026-08-03', to: '2026-08-03', status: 'confirmed', operational_status_id: status.id, seller_id: x.actor.id };
  assert.deepEqual(ids(x.db.snapshot(x.actor, filters).sales), [matched]);
  assert.equal(x.db.snapshot(x.actor, filters).dashboard.revenue_cents, 1000);
  for (const invalid of [{ q: 'x'.repeat(121) }, { q: {} }, { sale_type: 'both' }, { sale_type: true }, { from: '2026-02-30' }, { to: '2026-13-01' }, { from: '2026-08-04', to: '2026-08-03' }]) {
    assert.throws(() => x.db.listSales(x.actor, invalid), error => error.status === 400);
  }
});

test('consulta de vendas: busca e resumo mantêm isolamento por loja e permissões do vendedor', t => {
  const x = setup(t), user = x.db.addUser(x.actor, { name: 'Vendedor restrito', email: 'query-staff@example.test', password: 'senha-ficticia-de-teste', permissions: [] });
  const staff = x.db.actor(x.db.login({ email: user.email, password: 'senha-ficticia-de-teste' }).token);
  const assigned = sale(x, { wholesale: true, seller: staff.id }); sale(x, { wholesale: true, price: 2000 });
  const filters = { q: 'JOSE', sale_type: 'wholesale' }, state = x.db.snapshot(staff, filters);
  assert.deepEqual(ids(state.sales), [assigned]); assert.equal(state.dashboard.revenue_cents, 1000);
  assert.equal(state.dashboard.profit_cents, undefined); assert.equal(state.dashboard.fees_cents, undefined);
  assert.equal(state.sales[0].known_cost_cents, undefined);
  const other = x.db.actor(x.db.register({ name: 'Outra pessoa', store_name: 'Outra loja', email: 'query-other@example.test', password: 'senha-ficticia-de-teste' }).token);
  assert.deepEqual(x.db.snapshot(other, filters).sales, []); assert.equal(x.db.snapshot(other, filters).dashboard.sales_count, 0);
  assert.throws(() => x.db.listSales(other, { ...filters, seller_id: staff.id }), error => error.status === 404);
});

test('consulta de vendas: renomear cliente atualiza busca ativa e preserva nome fotografado no cancelamento', t => {
  const x = setup(t), active = sale(x), cancelled = sale(x); cancel(x, cancelled);
  x.db.updateCustomer(x.actor, x.customer.id, { name: 'Ana corrigida', edit_token: x.db.customer(x.actor, x.customer.id).edit_token });
  assert.deepEqual(ids(x.db.listSales(x.actor, { q: 'Ana corrigida' })), [active]);
  assert.deepEqual(ids(x.db.listSales(x.actor, { q: 'jose' })), [cancelled]);
  assert.equal(x.db.sale(x.actor, cancelled).customer_name, x.customer.name);
});
