import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';

function setup(t) {
  const db = new Store();
  t.after(() => db.close());
  const auth = db.register({
    name: 'Responsável', store_name: 'Loja ranking',
    email: `ranking-${randomUUID()}@example.test`, password: 'senha-ficticia-de-teste'
  });
  const actor = db.actor(auth.token);
  const customer = db.addCustomer(actor, { name: 'Cliente ranking' });
  const product = db.addProduct(actor, { name: 'Produto ranking', sku: 'RANK-1', price_cents: 1000 });
  db.receive(actor, { product_id: product.id, quantity: 100, unit_cost_cents: 200 });
  return { db, actor, token: auth.token, customer, product };
}

function addSeller(x, name, permissions = []) {
  return x.db.addUser(x.actor, {
    name, email: `seller-${randomUUID()}@example.test`,
    password: 'senha-ficticia-de-teste', permissions
  });
}

function addSale(x, {
  seller = x.actor.id, price = 1000, paid = price, date = '2026-08-03',
  wholesale = false, confirmed = true, description = 'Produto ranking', manualCost,
  reviewManual = false
} = {}) {
  const item = manualCost === undefined
    ? { product_id: x.product.id, description, quantity: 1, unit_price_cents: price }
    : { description, quantity: 1, unit_price_cents: price, manual_cost_cents: manualCost };
  const saleId = x.db.saveDraft(x.actor, {
    customer_id: x.customer.id, seller_id: seller, business_date: date,
    is_wholesale: wholesale, review_manual: reviewManual, items: [item]
  }).id;
  if (paid > 0) x.db.addPayment(x.actor, saleId, {
    method: 'cash', amount_cents: paid, request_id: randomUUID()
  });
  if (confirmed) x.db.confirm(x.actor, saleId, true);
  return saleId;
}

function cancelSale(x, saleId) {
  x.db.operations.cancelSale(x.actor, saleId, {
    edit_token: x.db.sale(x.actor, saleId).edit_token,
    request_id: randomUUID(), reason: 'Cancelamento para testar o ranking',
    acknowledge_stock_return: true, acknowledge_refund_pending: true
  });
}

test('ranking de vendedores soma somente confirmadas e fecha com os mesmos totais do dashboard', t => {
  const x = setup(t), sellerA = addSeller(x, 'Ana'), sellerB = addSeller(x, 'Bruno');
  addSale(x, { seller: sellerA.id, price: 3000, paid: 3000, manualCost: 1000 });
  addSale(x, { seller: sellerA.id, price: 1000, paid: 400, manualCost: 200 });
  addSale(x, { seller: sellerB.id, price: 2500, paid: 2600, manualCost: 500 });
  addSale(x, { seller: sellerB.id, price: 9000, confirmed: false });
  const cancelled = addSale(x, { seller: sellerB.id, price: 8000 });
  cancelSale(x, cancelled);

  const state = x.db.snapshot(x.actor, { from: '2026-08-03', to: '2026-08-03' });
  assert.deepEqual(state.seller_ranking, [
    {
      position: 1, seller_id: sellerA.id, seller_name: 'Ana', sales_count: 2,
      revenue_cents: 4000, gross_cents: 3400, pending_cents: 600,
      excess_cents: 0, incomplete_sales: 1, profit_cents: 2000, fees_cents: 0
    },
    {
      position: 2, seller_id: sellerB.id, seller_name: 'Bruno', sales_count: 1,
      revenue_cents: 2500, gross_cents: 2600, pending_cents: 0,
      excess_cents: 100, incomplete_sales: 1, profit_cents: 0, fees_cents: 0
    }
  ]);
  const total = key => state.seller_ranking.reduce((sum, row) => sum + row[key], 0);
  for (const key of ['sales_count', 'revenue_cents', 'gross_cents', 'pending_cents', 'excess_cents', 'incomplete_sales', 'profit_cents', 'fees_cents']) {
    assert.equal(total(key), state.dashboard[key], key);
  }
});

test('ranking acompanha em conjunto data, atacado, busca, situação, status, vendedor e conferência', t => {
  const x = setup(t), sellerA = addSeller(x, 'Ana'), sellerB = addSeller(x, 'Bruno');
  const matched = addSale(x, {
    seller: sellerA.id, price: 4000, paid: 1000, date: '2026-08-03',
    wholesale: true, description: 'Console azul'
  });
  addSale(x, { seller: sellerA.id, price: 5000, date: '2026-08-04', wholesale: true, description: 'Console azul' });
  addSale(x, { seller: sellerB.id, price: 6000, date: '2026-08-03', wholesale: false, description: 'Console azul' });
  const status = x.db.saveSaleStatus(x.actor, { name: 'Em separação', color: 'blue' });
  x.db.setOperationalStatus(x.actor, matched, { operational_status_id: status.id });
  const filters = {
    from: '2026-08-03', to: '2026-08-03', sale_type: 'wholesale', q: 'console azul',
    status: 'confirmed', operational_status_id: status.id, seller_id: sellerA.id, review: 'required'
  };
  const state = x.db.snapshot(x.actor, filters);
  assert.deepEqual(state.sales.map(sale => sale.id), [matched]);
  assert.deepEqual(state.seller_ranking.map(row => [row.position, row.seller_id, row.revenue_cents]), [[1, sellerA.id, 4000]]);
  assert.equal(state.dashboard.revenue_cents, state.seller_ranking[0].revenue_cents);
  assert.deepEqual(x.db.snapshot(x.actor, { ...filters, review: 'clear' }).seller_ranking, []);
  assert.deepEqual(x.db.snapshot(x.actor, { ...filters, status: 'draft' }).seller_ranking, []);
});

test('ranking dá a mesma posição aos empates e mantém desempate visual determinístico', t => {
  const x = setup(t), sellerA = addSeller(x, 'Ana'), sellerB = addSeller(x, 'Bruno'), sellerC = addSeller(x, 'Carla');
  addSale(x, { seller: sellerA.id, price: 1500 });
  addSale(x, { seller: sellerB.id, price: 2000 });
  addSale(x, { seller: sellerC.id, price: 1200 });
  addSale(x, { seller: sellerC.id, price: 800 });
  const ranking = x.db.snapshot(x.actor).seller_ranking;
  assert.deepEqual(ranking.map(row => [row.position, row.seller_name, row.sales_count, row.revenue_cents]), [
    [1, 'Carla', 2, 2000],
    [1, 'Bruno', 1, 2000],
    [3, 'Ana', 1, 1500]
  ]);
});

test('venda legada sem vendedor conserva totais, mas não recebe posição no ranking', t => {
  const x = setup(t), seller = addSeller(x, 'Ana');
  addSale(x, { seller: seller.id, price: 1000 });
  const legacy = addSale(x, { seller: seller.id, price: 9000 });
  x.db.run('UPDATE sales SET seller_id=NULL WHERE tenant_id=? AND id=?', x.actor.tenant_id, legacy);
  const state = x.db.snapshot(x.actor);
  assert.deepEqual(state.seller_ranking.map(row => [row.position, row.seller_id, row.seller_name, row.revenue_cents]), [
    [1, seller.id, 'Ana', 1000],
    [null, null, 'Sem vendedor', 9000]
  ]);
  assert.equal(state.seller_ranking.at(-1).incomplete_sales, 1);
  assert.equal(state.seller_ranking.reduce((sum, row) => sum + row.revenue_cents, 0), state.dashboard.revenue_cents);
});

test('ranking sinaliza pagamentos e custos pendentes sem tratar lucro desconhecido como ganho', t => {
  const x = setup(t), seller = addSeller(x, 'Ana'), noStock = x.db.addProduct(x.actor, { name: 'Sem custo', price_cents: 3000 });
  const saleId = x.db.saveDraft(x.actor, {
    customer_id: x.customer.id, seller_id: seller.id, business_date: '2026-08-03',
    items: [{ product_id: noStock.id, quantity: 1, unit_price_cents: 3000 }]
  }).id;
  x.db.addPayment(x.actor, saleId, { method: 'cash', amount_cents: 1000, request_id: randomUUID() });
  x.db.confirm(x.actor, saleId, true);
  const row = x.db.snapshot(x.actor).seller_ranking[0];
  assert.deepEqual(row, {
    position: 1, seller_id: seller.id, seller_name: 'Ana', sales_count: 1,
    revenue_cents: 3000, gross_cents: 1000, pending_cents: 2000,
    excess_cents: 0, incomplete_sales: 1, profit_cents: 0, fees_cents: 0
  });
  assert.equal(x.db.sale(x.actor, saleId).profit_cents, null);
  assert.equal(x.db.sale(x.actor, saleId).profit_state, 'pending_cost');
});

test('ranking respeita loja, alcance do vendedor e oculta lucro e taxas sem permissão', t => {
  const x = setup(t), user = addSeller(x, 'Vendedor restrito');
  const restricted = x.db.actor(x.db.login({ email: user.email, password: 'senha-ficticia-de-teste' }).token);
  addSale(x, { seller: user.id, price: 3000, manualCost: 1000 });
  addSale(x, { seller: x.actor.id, price: 7000, manualCost: 1000 });
  const state = x.db.snapshot(restricted);
  assert.equal(state.sales.length, 1);
  assert.deepEqual(state.seller_ranking, [{
    position: 1, seller_id: user.id, seller_name: 'Vendedor restrito', sales_count: 1,
    revenue_cents: 3000, gross_cents: 3000, pending_cents: 0,
    excess_cents: 0, incomplete_sales: 0
  }]);
  assert.equal('profit_cents' in state.seller_ranking[0], false);
  assert.equal('fees_cents' in state.seller_ranking[0], false);

  const otherAuth = x.db.register({
    name: 'Outra responsável', store_name: 'Outra loja',
    email: `other-${randomUUID()}@example.test`, password: 'senha-ficticia-de-teste'
  });
  const other = x.db.actor(otherAuth.token);
  assert.deepEqual(x.db.snapshot(other).seller_ranking, []);
});

test('hora de cadastro usa o instante real e não é inventada a partir da data comercial', t => {
  const x = setup(t), saleId = addSale(x, { date: '2020-01-02' });
  const registeredAt = '2026-09-13T18:42:31.456Z';
  const confirmedAt = '2026-09-13T18:45:09.000Z';
  x.db.run('UPDATE sales SET created_at=?,confirmed_at=? WHERE tenant_id=? AND id=?', registeredAt, confirmedAt, x.actor.tenant_id, saleId);
  const sale = x.db.snapshot(x.actor, { from: '2020-01-02', to: '2020-01-02' }).sales[0];
  assert.equal(sale.business_date, '2020-01-02');
  assert.equal(sale.registered_at, registeredAt);
  assert.equal(sale.created_at, registeredAt);
  assert.equal(sale.confirmed_at, confirmedAt);
  assert.notEqual(sale.registered_at.slice(0, 10), sale.business_date);

  const token = x.db.share(x.actor, saleId).token;
  const publicJson = JSON.stringify(x.db.public(token));
  assert.equal(publicJson.includes('registered_at'), false);
  assert.equal(publicJson.includes('created_at'), false);
  assert.equal(publicJson.includes(registeredAt), false);
});

test('API de estado entrega ranking filtrado e instante real de cadastro', async t => {
  const x = setup(t), seller = addSeller(x, 'Ana');
  const saleId = addSale(x, { seller: seller.id, price: 2300, date: '2020-01-02', wholesale: true });
  const registeredAt = '2026-09-13T19:15:42.321Z';
  x.db.run('UPDATE sales SET created_at=? WHERE tenant_id=? AND id=?', registeredAt, x.actor.tenant_id, saleId);
  const origin = 'http://127.0.0.1';
  const { server } = application({ store: x.db, origin });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/state?from=2020-01-02&to=2020-01-02&sale_type=wholesale`, {
    headers: { Cookie: `pdv_session=${x.token}` }
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.sales.length, 1);
  assert.equal(payload.sales[0].registered_at, registeredAt);
  assert.equal(payload.sales[0].business_date, '2020-01-02');
  assert.deepEqual(payload.seller_ranking.map(row => [row.position, row.seller_name, row.revenue_cents]), [[1, 'Ana', 2300]]);
});
