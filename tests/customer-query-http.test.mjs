import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';
import { salesFilterValues } from '../public/date-control.mjs';

async function setup(t) {
  const db = new Store(), origin = 'http://127.0.0.1:3999', { server } = application({ store: db, origin });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const registration = db.register({ name: 'Administrador HTTP', store_name: 'Consultas HTTP', email: 'customer-query-http@example.test', password: 'senha-ficticia-de-teste' });
  const actor = db.actor(registration.token), headers = { Cookie: 'pdv_session=' + registration.token, Origin: origin, 'Content-Type': 'application/json' };
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = (path, data, method = data ? 'PUT' : 'GET', override = headers) => fetch(base + '/api' + path, { method, headers: override, ...(data ? { body: JSON.stringify(data) } : {}) });
  const customer = db.addCustomer(actor, { name: 'João Histórico', email: 'cliente@example.test', phone: '11999990000' });
  return { db, actor, headers, call, customer };
}

test('HTTP: resumo e vendas compartilham filtros por tipo/busca e mantêm datas inclusivas', async t => {
  const x = await setup(t);
  for (const [is_wholesale, price] of [[true, 1000], [false, 2000]]) {
    const key = x.db.saveDraft(x.actor, { is_wholesale, customer_id: x.customer.id, seller_id: x.actor.id, business_date: '2026-08-03', items: [{ description: 'Serviço de configuração', quantity: 1, unit_price_cents: price, manual_cost_cents: 200 }] }).id;
    x.db.addPayment(x.actor, key, { method: 'cash', amount_cents: price, request_id: randomUUID() }); x.db.confirm(x.actor, key, true);
  }
  let response = await x.call('/state?sale_type=wholesale&q=JOAO&from=2026-08-03&to=2026-08-03');
  assert.equal(response.status, 200); let state = await response.json(); assert.equal(state.sales.length, 1); assert.equal(state.sales[0].is_wholesale, true);
  assert.equal(state.dashboard.revenue_cents, 1000); assert.equal(state.dashboard.profit_cents, 800);
  response = await x.call('/state?sale_type=retail&q=%230002'); state = await response.json(); assert.equal(state.sales.length, 1); assert.equal(state.dashboard.revenue_cents, 2000);
  response = await x.call('/state?date_preset=all&sale_type=all'); state = await response.json(); assert.equal(state.sales.length, 2); assert.equal(state.dashboard.revenue_cents, 3000);
  response = await x.call('/state?sale_type=wholesale&q=ausente'); state = await response.json(); assert.deepEqual(state.sales, []); assert.equal(state.dashboard.revenue_cents, 0);
  for (const query of ['sale_type=invalid', 'q=' + 'a'.repeat(121), 'from=2026-02-30', 'from=2026-08-04&to=2026-08-03']) assert.equal((await x.call('/state?' + query)).status, 400);
  assert.equal((await x.call('/state?sale_type=wholesale&q=joao', null, 'GET', {})).status, 401);
});

test('HTTP: Hoje/Ontem e Atacado/Varejo atualizam lista e métricas na mesma consulta', async t => {
  const x = await setup(t), today = '2026-09-13', expected = new Map();
  for (const row of [
    { preset: 'today', business_date: today, sale_type: 'wholesale', price: 1100 },
    { preset: 'today', business_date: today, sale_type: 'retail', price: 1200 },
    { preset: 'yesterday', business_date: '2026-09-12', sale_type: 'wholesale', price: 2100 },
    { preset: 'yesterday', business_date: '2026-09-12', sale_type: 'retail', price: 2200 }
  ]) {
    const saved = x.db.saveDraft(x.actor, {
      is_wholesale: row.sale_type === 'wholesale', customer_id: x.customer.id, seller_id: x.actor.id,
      business_date: row.business_date,
      items: [{ description: `${row.preset} ${row.sale_type}`, quantity: 1, unit_price_cents: row.price, manual_cost_cents: 100 }]
    });
    x.db.addPayment(x.actor, saved.id, { method: 'cash', amount_cents: row.price, request_id: randomUUID() });
    x.db.confirm(x.actor, saved.id, true);
    expected.set(`${row.preset}:${row.sale_type}`, { id: saved.id, price: row.price });
  }

  for (const [preset, saleType] of [['today', 'retail'], ['yesterday', 'retail'], ['yesterday', 'wholesale'], ['today', 'wholesale']]) {
    const filters = salesFilterValues({ date_preset: preset, sale_type: saleType }, today);
    const response = await x.call('/state?' + new URLSearchParams(filters));
    assert.equal(response.status, 200);
    const state = await response.json(), match = expected.get(`${preset}:${saleType}`);
    assert.deepEqual(state.sales.map(sale => sale.id), [match.id]);
    assert.equal(state.dashboard.sales_count, 1);
    assert.equal(state.dashboard.revenue_cents, match.price);
    assert.equal(state.dashboard.gross_cents, match.price);
    assert.equal(state.dashboard.revenue_cents,
      state.sales.filter(sale => sale.status === 'confirmed').reduce((sum, sale) => sum + sale.total_cents, 0));
  }
});

test('HTTP: edição de cliente exige sessão, origem, permissão e token e preserva campos omitidos', async t => {
  const x = await setup(t), path = '/customers/' + x.customer.id;
  assert.equal((await x.call(path, null, 'GET', {})).status, 401);
  let response = await x.call(path); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const original = await response.json(); assert.match(original.edit_token, /^[a-f0-9]{64}$/);
  const data = { edit_token: original.edit_token, name: 'João corrigido' };
  assert.equal((await x.call(path, data, 'PUT', { ...x.headers, Origin: 'https://outro.example' })).status, 403);
  assert.equal((await x.call(path, data, 'PUT', { Origin: x.headers.Origin, 'Content-Type': 'application/json' })).status, 401);
  assert.equal((await x.call(path, { ...data, email: 'inválido' })).status, 400);
  assert.equal((await x.call(path, { ...data, cpf: '11111111111' })).status, 400);
  response = await x.call(path, data); assert.equal(response.status, 200); const changed = await response.json();
  assert.equal(changed.name, data.name); assert.equal(changed.email, x.customer.email); assert.equal(changed.phone, x.customer.phone); assert.equal(changed.cpf, '');
  assert.notEqual(changed.edit_token, original.edit_token); assert.equal((await x.call(path, data)).status, 409);
  const staff = x.db.addUser(x.actor, { name: 'Sem cadastro', email: 'customer-query-staff@example.test', password: 'senha-ficticia-de-teste', permissions: [] });
  const token = x.db.login({ email: staff.email, password: 'senha-ficticia-de-teste' }).token, staffHeaders = { ...x.headers, Cookie: 'pdv_session=' + token };
  assert.equal((await (await x.call(path, null, 'GET', staffHeaders)).json()).edit_token, undefined);
  assert.equal((await x.call(path, { name: 'Proibido', edit_token: changed.edit_token }, 'PUT', staffHeaders)).status, 403);
  const other = x.db.register({ name: 'Outra pessoa', store_name: 'Outra loja', email: 'customer-query-other@example.test', password: 'senha-ficticia-de-teste' });
  const otherHeaders = { ...x.headers, Cookie: 'pdv_session=' + other.token };
  assert.equal((await x.call(path, null, 'GET', otherHeaders)).status, 404);
  assert.equal((await x.call(path, { name: 'Outra loja', edit_token: changed.edit_token }, 'PUT', otherHeaders)).status, 404);
  assert.equal((await x.call('/customers', { name: 'Contato inválido', email: 'inválido' }, 'POST')).status, 400);
});

test('HTTP: duas edições concorrentes do cliente salvam apenas uma alteração auditada', async t => {
  const x = await setup(t), path = '/customers/' + x.customer.id, current = await (await x.call(path)).json();
  const responses = await Promise.all(['Primeira correção', 'Segunda correção'].map(name => x.call(path, { name, edit_token: current.edit_token })));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const bodies = await Promise.all(responses.map(response => response.json())), saved = bodies[responses.findIndex(response => response.status === 200)];
  assert.equal((await (await x.call(path)).json()).name, saved.name);
  assert.equal(x.db.all("SELECT id FROM audit WHERE entity='customer' AND entity_id=? AND action='updated'", x.customer.id).length, 1);
  assert.deepEqual(x.db.all('PRAGMA foreign_key_check'), []);
});
