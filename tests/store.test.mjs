import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { PERMISSIONS } from '../src/domain.mjs';

function setup(t) {
  const db = new Store(); t.after(() => db.close());
  const reg = db.register({ name: 'Administrador', store_name: 'Gamecell teste', email: 'owner@example.test', password: 'senha-de-teste-123' });
  const actor = db.actor(reg.token);
  const customer = db.addCustomer(actor, { name: 'Cliente de teste' });
  const product = db.addProduct(actor, { name: 'Produto teste', price_cents: 10000 });
  return { db, actor, customer, product, token: reg.token };
}
function draft(x, extra = {}) {
  return x.db.saveDraft(x.actor, { customer_id: x.customer.id, seller_id: x.actor.id,
    items: [{ product_id: x.product.id, quantity: 1, unit_price_cents: 10000 }], ...extra }).id;
}
function payment(db, actor, saleId, data, requestId = randomUUID()) {
  const payload = { ...data, request_id: requestId };
  if (payload.method === 'pix' && payload.pix_account_id === undefined) {
    const account = db.get(`SELECT id FROM pix_accounts WHERE tenant_id=? AND name='Conta Pix de teste'`, actor.tenant_id)
      ?? db.savePixAccount(actor, { name: 'Conta Pix de teste' });
    payload.pix_account_id = account.id;
  }
  return db.addPayment(actor, saleId, payload);
}

test('cadastro principal cria loja independente e login válido', t => {
  const x = setup(t);
  assert.equal(x.db.actor(x.db.login({ email: 'OWNER@example.test', password: 'senha-de-teste-123' }).token).tenant_id, x.actor.tenant_id);
  assert.throws(() => x.db.login({ email: 'owner@example.test', password: 'incorreta' }));
});
test('sessão deixa de funcionar depois do logout', t => {
  const x = setup(t); x.db.logout(x.token); assert.throws(() => x.db.actor(x.token), /login/);
});
test('segunda loja não lista nem acessa registros da primeira', t => {
  const x = setup(t), saleId = draft(x);
  const y = x.db.actor(x.db.register({ name: 'Outro', store_name: 'Outra loja', email: 'other@example.test', password: 'senha-de-teste-456' }).token);
  assert.equal(x.db.snapshot(y).products.length, 0);
  assert.equal(x.db.snapshot(y).customers.length, 0);
  assert.throws(() => x.db.sale(y, saleId), /não encontrado/);
  assert.throws(() => x.db.saveDraft(y, { customer_id: x.customer.id, items: [] }), /não encontrado/);
  assert.throws(() => x.db.receive(y, { product_id: x.product.id, quantity: 1, unit_cost_cents: 1 }), /não encontrado/);
});
test('rascunho vazio é persistido e não movimenta estoque/dashboard', t => {
  const x = setup(t);
  x.db.receive(x.actor, { product_id: x.product.id, quantity: 2, unit_cost_cents: 5000 });
  x.db.saveDraft(x.actor, { items: [] }); draft(x);
  const state = x.db.snapshot(x.actor); assert.equal(state.products[0].stock, 2); assert.equal(state.dashboard.sales_count, 0);
});
test('FIFO usa dois lotes e preserva o custo da venda', t => {
  const x = setup(t);
  x.db.receive(x.actor, { product_id: x.product.id, quantity: 2, unit_cost_cents: 10000 });
  x.db.receive(x.actor, { product_id: x.product.id, quantity: 3, unit_cost_cents: 12000 });
  const saleId = draft(x, { items: [{ product_id: x.product.id, quantity: 3, unit_price_cents: 20000 }] });
  payment(x.db, x.actor, saleId, { method: 'pix', amount_cents: 60000 }); x.db.confirm(x.actor, saleId);
  assert.equal(x.db.sale(x.actor, saleId).known_cost_cents, 32000);
  assert.equal(x.db.products(x.actor)[0].stock, 2);
  assert.equal(x.db.sale(x.actor, saleId).profit_cents, 28000);
});
test('confirmação é idempotente: não baixa duas vezes', t => {
  const x = setup(t); x.db.receive(x.actor, { product_id: x.product.id, quantity: 2, unit_cost_cents: 5000 });
  const saleId = draft(x); x.db.confirm(x.actor, saleId, true); x.db.confirm(x.actor, saleId, true);
  assert.equal(x.db.products(x.actor)[0].stock, 1);
});
test('pagamento pendente permite confirmação explícita', t => {
  const x = setup(t), saleId = draft(x);
  assert.throws(() => x.db.confirm(x.actor, saleId), /diferença/);
  x.db.confirm(x.actor, saleId, true);
  const sale = x.db.sale(x.actor, saleId); assert.equal(sale.status, 'confirmed'); assert.equal(sale.reconciliation.pending_cents, 10000);
});
test('estoque negativo é permitido, custo não apurado não vira lucro', t => {
  const x = setup(t), saleId = draft(x); payment(x.db, x.actor, saleId, { method: 'cash', amount_cents: 10000 });
  x.db.confirm(x.actor, saleId); const s = x.db.sale(x.actor, saleId);
  assert.equal(x.db.products(x.actor)[0].stock, -1); assert.equal(s.profit_cents, null); assert.equal(s.pending_cost_quantity, 1);
  assert.equal(x.db.snapshot(x.actor).dashboard.incomplete_sales, 1);
});
test('entrada posterior resolve falta de custo sem duplicar estoque', t => {
  const x = setup(t), saleId = draft(x); payment(x.db, x.actor, saleId, { method: 'pix', amount_cents: 10000 }); x.db.confirm(x.actor, saleId);
  const receipt = x.db.receive(x.actor, { product_id: x.product.id, quantity: 3, unit_cost_cents: 4000 });
  assert.equal(receipt.resolved_quantity, 1); assert.equal(x.db.products(x.actor)[0].stock, 2);
  assert.equal(x.db.sale(x.actor, saleId).profit_cents, 6000);
});
test('resolução parcial de custo pendente por várias entradas', t => {
  const x = setup(t), saleId = draft(x, { items: [{ product_id: x.product.id, quantity: 3, unit_price_cents: 10000 }] });
  x.db.confirm(x.actor, saleId, true);
  x.db.receive(x.actor, { product_id: x.product.id, quantity: 1, unit_cost_cents: 4000 });
  assert.equal(x.db.sale(x.actor, saleId).pending_cost_quantity, 2); assert.equal(x.db.products(x.actor)[0].stock, -2);
  x.db.receive(x.actor, { product_id: x.product.id, quantity: 2, unit_cost_cents: 5000 });
  assert.equal(x.db.sale(x.actor, saleId).known_cost_cents, 14000); assert.equal(x.db.products(x.actor)[0].stock, 0);
});
test('avulso não cria produto nem lote nem alocação de estoque', t => {
  const x = setup(t), saleId = draft(x, { items: [{ description: 'Avulso', quantity: 2, unit_price_cents: 10000, manual_cost_cents: 3500 }] });
  payment(x.db, x.actor, saleId, { method: 'pix', amount_cents: 20000 }); x.db.confirm(x.actor, saleId);
  assert.equal(x.db.products(x.actor).length, 1); assert.equal(x.db.all('SELECT * FROM lots').length, 0);
  assert.equal(x.db.all('SELECT * FROM allocations').length, 0); assert.equal(x.db.sale(x.actor, saleId).profit_cents, 13000);
});
test('taxa fica fotografada na venda e edição não altera pagamento antigo', t => {
  const x = setup(t), data = { machine: 'Máquina X', brand: 'Visa', mode: 'credit', installments: 10, basis_points: 400 };
  const rate = x.db.saveRate(x.actor, data), saleId = draft(x), requestId = randomUUID();
  const first = payment(x.db, x.actor, saleId, { method: 'card', rate_id: rate.id, amount_cents: 10000 }, requestId);
  x.db.saveRate(x.actor, { ...data, basis_points: 900 }, rate.id);
  const replay = payment(x.db, x.actor, saleId, { method: 'card', rate_id: rate.id, amount_cents: 10000 }, requestId);
  assert.equal(replay.id, first.id); assert.equal(replay.replayed, true);
  assert.equal(x.db.all('SELECT * FROM payments WHERE sale_id=?', saleId).length, 1);
  assert.equal(x.db.sale(x.actor, saleId).payments[0].fee_cents, 400);
});

test('pagamento exige request_id UUID', t => {
  const x = setup(t), saleId = draft(x);
  assert.throws(() => x.db.addPayment(x.actor, saleId, { method: 'pix', amount_cents: 10000 }), /request_id.*UUID/);
  assert.throws(() => x.db.addPayment(x.actor, saleId, { request_id: 'não-é-uuid', method: 'pix', amount_cents: 10000 }), /request_id.*UUID/);
  assert.throws(() => x.db.addPayment(x.actor, saleId, { request_id: '00000000-0000-0000-0000-000000000000', method: 'pix', amount_cents: 10000 }), /request_id.*UUID/);
  assert.throws(() => payment(x.db, x.actor, saleId, { method: 'pix', amount_cents: 10000, rate_id: randomUUID() }), /Taxa.*cartão/);
  assert.equal(x.db.all('SELECT * FROM payments').length, 0);
});

test('replay idêntico retorna o mesmo pagamento sem duplicar linha ou auditoria', t => {
  const x = setup(t), saleId = draft(x), requestId = randomUUID();
  const first = payment(x.db, x.actor, saleId, { method: 'pix', amount_cents: 10000 }, requestId);
  const replay = payment(x.db, x.actor, saleId, { method: 'pix', amount_cents: 10000 }, requestId);
  assert.equal(first.replayed, false); assert.equal(replay.replayed, true); assert.equal(replay.id, first.id);
  assert.equal(x.db.all('SELECT * FROM payments WHERE tenant_id=? AND sale_id=?', x.actor.tenant_id, saleId).length, 1);
  assert.equal(x.db.all("SELECT * FROM audit WHERE tenant_id=? AND entity='payment' AND action='recorded'", x.actor.tenant_id).length, 1);
  assert.equal(x.db.sale(x.actor, saleId).reconciliation.gross_cents, 10000);
});

test('mesmo request_id com payload diferente falha com conflito', t => {
  const x = setup(t), saleId = draft(x), otherSaleId = draft(x), requestId = randomUUID();
  payment(x.db, x.actor, saleId, { method: 'pix', amount_cents: 4000 }, requestId);
  assert.throws(
    () => payment(x.db, x.actor, saleId, { method: 'pix', amount_cents: 5000 }, requestId),
    error => error.status === 409 && /já foi usado/.test(error.message)
  );
  assert.throws(
    () => payment(x.db, x.actor, otherSaleId, { method: 'pix', amount_cents: 4000 }, requestId),
    error => error.status === 409 && /já foi usado/.test(error.message)
  );
  assert.equal(x.db.all('SELECT * FROM payments WHERE sale_id=?', saleId).length, 1);
  assert.equal(x.db.all('SELECT * FROM payments WHERE sale_id=?', otherSaleId).length, 0);
});

test('chaves diferentes permitem partes idênticas e a chave é isolada por loja', t => {
  const x = setup(t), saleId = draft(x), sharedRequestId = randomUUID();
  const first = payment(x.db, x.actor, saleId, { method: 'cash', amount_cents: 5000 }, sharedRequestId);
  const second = payment(x.db, x.actor, saleId, { method: 'cash', amount_cents: 5000 }, randomUUID());
  assert.notEqual(second.id, first.id);
  assert.equal(x.db.all('SELECT * FROM payments WHERE tenant_id=? AND sale_id=?', x.actor.tenant_id, saleId).length, 2);

  const registration = x.db.register({ name: 'Outra pessoa', store_name: 'Outra loja', email: 'idem-other@example.test', password: 'senha-de-teste-456' });
  const other = x.db.actor(registration.token), otherSaleId = x.db.saveDraft(other, { items: [] }).id;
  const isolated = payment(x.db, other, otherSaleId, { method: 'cash', amount_cents: 5000 }, sharedRequestId);
  assert.notEqual(isolated.id, first.id);
  assert.equal(x.db.all('SELECT * FROM payment_requests WHERE request_id=?', sharedRequestId).length, 2);
});
test('máquina de outra loja é rejeitada', t => {
  const x = setup(t), rate = x.db.saveRate(x.actor, { machine: 'X', brand: 'Visa', mode: 'credit', installments: 1, basis_points: 400 });
  const y = x.db.actor(x.db.register({ name: 'B', store_name: 'B', email: 'b@example.test', password: 'senha-de-teste-456' }).token);
  const sale = x.db.saveDraft(y, { items: [] });
  assert.throws(() => payment(x.db, y, sale.id, { method: 'card', rate_id: rate.id, amount_cents: 1 }), /não encontrado/);
});
test('frete e despesas são internos e diminuem resultado', t => {
  const x = setup(t), saleId = draft(x, { freight_cents: 1000, expenses: [{ description: 'Embalagem', amount_cents: 500 }],
    items: [{ description: 'Avulso', quantity: 1, unit_price_cents: 10000, manual_cost_cents: 4000 }] });
  payment(x.db, x.actor, saleId, { method: 'pix', amount_cents: 10000 }); x.db.confirm(x.actor, saleId);
  assert.equal(x.db.sale(x.actor, saleId).profit_cents, 4500);
});
test('pagamentos divergentes não integram lucro apurado', t => {
  const x = setup(t), saleId = draft(x, { items: [{ description: 'Avulso', quantity: 1, unit_price_cents: 10000, manual_cost_cents: 4000 }] });
  payment(x.db, x.actor, saleId, { method: 'cash', amount_cents: 11000 }); x.db.confirm(x.actor, saleId, true);
  const sale = x.db.sale(x.actor, saleId); assert.equal(sale.profit_cents, null); assert.equal(sale.provisional_profit_cents, 6000);
  assert.equal(x.db.snapshot(x.actor).dashboard.revenue_cents, 10000); assert.equal(x.db.snapshot(x.actor).dashboard.profit_cents, 0);
});
test('pagamento posterior quita venda confirmada', t => {
  const x = setup(t), saleId = draft(x, { items: [{ description: 'Avulso', quantity: 1, unit_price_cents: 10000, manual_cost_cents: 4000 }] });
  payment(x.db, x.actor, saleId, { method: 'pix', amount_cents: 4000 }); x.db.confirm(x.actor, saleId, true);
  payment(x.db, x.actor, saleId, { method: 'cash', amount_cents: 6000 });
  assert.equal(x.db.sale(x.actor, saleId).profit_cents, 6000);
});
test('compartilhamento público não contém finanças internas nem dados de autenticação', t => {
  const x = setup(t), saleId = draft(x, { freight_cents: 1000, expenses: [{ description: 'INTERNO', amount_cents: 500 }],
    items: [{ description: 'Avulso', quantity: 1, unit_price_cents: 10000, manual_cost_cents: 4000 }] });
  const operationalStatus = x.db.saveSaleStatus(x.actor, { name: 'STATUS_INTERNO', color: 'red' });
  x.db.setOperationalStatus(x.actor, saleId, { operational_status_id: operationalStatus.id });
  const rate = x.db.saveRate(x.actor, { machine: 'MAQUINA_INTERNA', brand: 'Visa', mode: 'credit', installments: 1, basis_points: 400 });
  payment(x.db, x.actor, saleId, { method: 'card', rate_id: rate.id, amount_cents: 10000 }); x.db.confirm(x.actor, saleId);
  const token = x.db.share(x.actor, saleId).token, publicData = x.db.public(token), json = JSON.stringify(publicData);
  assert.equal(publicData.total_cents, 10000);
  for (const forbidden of ['cost', 'profit', 'fee_', 'net_', 'basis_points', 'freight', 'expenses', 'password', 'salt', 'tenant_id', 'MAQUINA_INTERNA', 'INTERNO', 'operational_status']) assert.ok(!json.includes(forbidden), forbidden);
  const next = x.db.share(x.actor, saleId).token; assert.throws(() => x.db.public(token), /expirado/); assert.ok(x.db.public(next));
});
test('vendedor pertence à loja e não recebe custo ou lucro sem permissão', t => {
  const x = setup(t);
  const seller = x.db.addUser(x.actor, { name: 'Vendedor', email: 'seller@example.test', password: 'senha-de-teste-456', permissions: ['sales.create', 'sales.confirm'] });
  const user = x.db.actor(x.db.login({ email: 'seller@example.test', password: 'senha-de-teste-456' }).token);
  assert.equal(user.tenant_id, x.actor.tenant_id);
  const saleId = x.db.saveDraft(user, { customer_id: x.customer.id, seller_id: seller.id, items: [{ product_id: x.product.id, quantity: 1, unit_price_cents: 10000 }] }).id;
  x.db.confirm(user, saleId, true);
  const sale = x.db.sale(user, saleId);
  assert.ok(!('profit_cents' in sale)); assert.ok(!('known_cost_cents' in sale)); assert.ok(!('net_cents' in sale.reconciliation));
  assert.ok(!('manual_cost_cents' in sale.items[0])); assert.throws(() => x.db.receive(user, { product_id: x.product.id, quantity: 1, unit_cost_cents: 1 }), /permitido/);
});
test('edição de permissões tem efeito na próxima requisição', t => {
  const x = setup(t), seller = x.db.addUser(x.actor, { name: 'V', email: 'v@example.test', password: 'senha-de-teste-456', permissions: [] });
  const token = x.db.login({ email: 'v@example.test', password: 'senha-de-teste-456' }).token;
  assert.throws(() => x.db.saveDraft(x.db.actor(token), { items: [] }), /permitido/);
  x.db.updatePermissions(x.actor, seller.id, { permissions: ['sales.create'] });
  assert.ok(x.db.saveDraft(x.db.actor(token), { items: [] }).id);
});
test('vendedor não promove a si nem concede permissões que não possui', t => {
  const x = setup(t), u = x.db.addUser(x.actor, { name: 'V', email: 'v@example.test', password: 'senha-de-teste-456', permissions: ['users.manage'] });
  const v = x.db.actor(x.db.login({ email: 'v@example.test', password: 'senha-de-teste-456' }).token);
  assert.throws(() => x.db.updatePermissions(v, u.id, { permissions: PERMISSIONS }));
  assert.throws(() => x.db.addUser(v, { name: 'Outro', email: 'o@example.test', password: 'senha-de-teste-789', permissions: ['profit.view'] }));
});
test('confirmação incompleta falha sem consumir lotes', t => {
  const x = setup(t); x.db.receive(x.actor, { product_id: x.product.id, quantity: 2, unit_cost_cents: 4000 });
  const saleId = draft(x, { customer_id: null }); assert.throws(() => x.db.confirm(x.actor, saleId, true));
  assert.equal(x.db.products(x.actor)[0].stock, 2); assert.equal(x.db.sale(x.actor, saleId).status, 'draft');
});
test('filtro por data e vendedor respeita escopo', t => {
  const x = setup(t), saleId = draft(x); x.db.confirm(x.actor, saleId, true);
  assert.equal(x.db.listSales(x.actor, { from: '2099-01-01' }).length, 0);
  assert.equal(x.db.listSales(x.actor, { seller_id: x.actor.id, status: 'confirmed' }).length, 1);
});

test('status operacional é configurável sem alterar confirmação, estoque ou filtros técnicos', t => {
  const x = setup(t);
  x.db.receive(x.actor, { product_id: x.product.id, quantity: 2, unit_cost_cents: 4000 });
  const saleId = draft(x), status = x.db.saveSaleStatus(x.actor, { name: 'Aguardando retirada', color: 'amber' });
  let sale = x.db.setOperationalStatus(x.actor, saleId, { operational_status_id: status.id });
  assert.equal(sale.status, 'draft');
  assert.equal(sale.operational_status_id, status.id);
  assert.deepEqual(sale.operational_status, status);
  assert.equal(x.db.listSales(x.actor, { operational_status_id: status.id }).length, 1);
  assert.equal(x.db.listSales(x.actor, { status: 'confirmed' }).length, 0);

  x.db.confirm(x.actor, saleId, true); x.db.confirm(x.actor, saleId, true);
  sale = x.db.sale(x.actor, saleId);
  assert.equal(sale.status, 'confirmed');
  assert.equal(sale.operational_status.name, 'Aguardando retirada');
  assert.equal(x.db.products(x.actor)[0].stock, 1);
  assert.equal(x.db.listSales(x.actor, { status: 'confirmed', operational_status_id: status.id }).length, 1);

  const auditsBeforeNoop = x.db.all("SELECT id FROM audit WHERE entity='sale' AND action='operational_status_changed'").length;
  x.db.setOperationalStatus(x.actor, saleId, { operational_status_id: status.id });
  assert.equal(x.db.all("SELECT id FROM audit WHERE entity='sale' AND action='operational_status_changed'").length, auditsBeforeNoop);
  x.db.saveSaleStatus(x.actor, { name: 'Pronto para retirada', color: 'green' }, status.id);
  assert.deepEqual(x.db.sale(x.actor, saleId).operational_status, { id: status.id, name: 'Pronto para retirada', color: 'green' });
  x.db.setOperationalStatus(x.actor, saleId, { operational_status_id: null });
  assert.equal(x.db.sale(x.actor, saleId).operational_status, null);
  assert.equal(x.db.sale(x.actor, saleId).operational_status_id, null);
});

test('cadastro e atribuição de status validam nome, cor, permissão e isolamento por loja', t => {
  const x = setup(t), status = x.db.saveSaleStatus(x.actor, { name: 'Entregue', color: 'purple' });
  assert.throws(() => x.db.saveSaleStatus(x.actor, { name: 'entregue', color: 'green' }),
    error => error.status === 409 && /Já existe/.test(error.message));
  assert.throws(() => x.db.saveSaleStatus(x.actor, { name: 'Inválido', color: 'orange' }), /Cor.*inválida/);
  assert.throws(() => x.db.saveSaleStatus(x.actor, { name: null }, status.id), /Nome do status inválido/);

  const seller = x.db.addUser(x.actor, { name: 'V', email: 'status-seller@example.test', password: 'senha-de-teste-456', permissions: ['sales.create'] });
  const sellerToken = x.db.login({ email: 'status-seller@example.test', password: 'senha-de-teste-456' }).token;
  let sellerActor = x.db.actor(sellerToken);
  const sellerSaleId = x.db.saveDraft(sellerActor, { seller_id: seller.id, items: [] }).id;
  assert.throws(() => x.db.setOperationalStatus(sellerActor, sellerSaleId, { operational_status_id: status.id }), /permitido/);
  assert.throws(() => x.db.saveSaleStatus(sellerActor, { name: 'Sem acesso', color: 'red' }), /permitido/);
  x.db.updatePermissions(x.actor, seller.id, { permissions: ['sales.create', 'sales.change_status'] });
  sellerActor = x.db.actor(sellerToken);
  assert.equal(x.db.setOperationalStatus(sellerActor, sellerSaleId, { operational_status_id: status.id }).operational_status_id, status.id);

  const other = x.db.actor(x.db.register({ name: 'Outro', store_name: 'Outra loja', email: 'status-other@example.test', password: 'senha-de-teste-456' }).token);
  const sameName = x.db.saveSaleStatus(other, { name: 'Entregue', color: 'green' });
  const otherSaleId = x.db.saveDraft(other, { items: [] }).id;
  assert.notEqual(sameName.id, status.id);
  assert.throws(() => x.db.setOperationalStatus(other, otherSaleId, { operational_status_id: status.id }), /não encontrado/);
  assert.throws(() => x.db.listSales(other, { operational_status_id: status.id }), /não encontrado/);
});

test('editar rascunho sem visualizar custos não apaga valores internos', t => {
  const x = setup(t), u = x.db.addUser(x.actor, {name:'V',email:'v@example.test',password:'senha-de-teste-456',permissions:['sales.edit_draft','sales.create']});
  const saleId = draft(x, {seller_id:u.id,freight_cents:1234,expenses:[{description:'Interno',amount_cents:321}],
    items:[{description:'Avulso',quantity:1,unit_price_cents:10000,manual_cost_cents:5000}]});
  const v = x.db.actor(x.db.login({email:'v@example.test',password:'senha-de-teste-456'}).token), visible=x.db.sale(v,saleId);
  x.db.saveDraft(v, {draft_token:x.db.operations.draftToken(v,saleId),...({customer_id:x.customer.id,seller_id:u.id,items:visible.items.map(i=>({id:i.id,description:i.description,quantity:2,unit_price_cents:i.unit_price_cents}))})}, saleId);
  const updated=x.db.sale(x.actor,saleId);
  assert.equal(updated.items[0].manual_cost_cents,5000);assert.equal(updated.freight_cents,1234);assert.equal(updated.expenses[0].amount_cents,321);
});

test('saldo e vendas persistem depois de reabrir o banco', async t => {
  const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const dir=mkdtempSync(join(tmpdir(),'pdv-test-'));
  let db;
  t.after(()=>{db?.close();rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:50});});
  db=new Store(join(dir,'test.sqlite'));
  const auth=db.register({name:'A',store_name:'Loja persistente',email:'persist@example.test',password:'senha-de-teste-456'});
  const a=db.actor(auth.token),p=db.addProduct(a,{name:'Persistente',price_cents:100});
  db.receive(a,{product_id:p.id,quantity:7,unit_cost_cents:50});db.close();
  db=new Store(join(dir,'test.sqlite'));
  assert.equal(db.products(db.actor(auth.token))[0].stock,7);
});

test('migração aditiva habilita idempotência sem perder pagamentos existentes', async t => {
  const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const dir=mkdtempSync(join(tmpdir(),'pdv-idem-migration-'));let db;
  t.after(()=>{db?.close();rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:50});});
  const dbPath=join(dir,'legacy.sqlite');db=new Store(dbPath);
  const auth=db.register({name:'A',store_name:'Loja existente',email:'migration@example.test',password:'senha-de-teste-456'});
  let actor=db.actor(auth.token),saleId=db.saveDraft(actor,{items:[]}).id;
  payment(db,actor,saleId,{method:'pix',amount_cents:1000});
  db.db.exec('DROP TABLE payment_requests');db.close();db=null;

  db=new Store(dbPath);actor=db.actor(auth.token);
  assert.equal(db.all('SELECT * FROM payments WHERE sale_id=?',saleId).length,1);
  assert.equal(db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='payment_requests'").length,1);
  payment(db,actor,saleId,{method:'pix',amount_cents:2000});
  assert.equal(db.all('SELECT * FROM payments WHERE sale_id=?',saleId).length,2);
});

test('migração aditiva cria status operacionais sem reconstruir vendas existentes', async t => {
  const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const dir=mkdtempSync(join(tmpdir(),'pdv-status-migration-'));let db;
  t.after(()=>{db?.close();rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:50});});
  const dbPath=join(dir,'legacy.sqlite');db=new Store(dbPath);
  const auth=db.register({name:'A',store_name:'Loja existente',email:'status-migration@example.test',password:'senha-de-teste-456'});
  let actor=db.actor(auth.token);
  const customer=db.addCustomer(actor,{name:'Cliente legado'}),product=db.addProduct(actor,{name:'Produto legado',price_cents:1000});
  db.receive(actor,{product_id:product.id,quantity:2,unit_cost_cents:400});
  const saleId=db.saveDraft(actor,{customer_id:customer.id,seller_id:actor.id,items:[{product_id:product.id,quantity:1,unit_price_cents:1000}]}).id;
  payment(db,actor,saleId,{method:'pix',amount_cents:1000});db.confirm(actor,saleId);
  db.db.exec('DROP TABLE sale_status_assignments; DROP TABLE sale_statuses');db.close();db=null;

  db=new Store(dbPath);actor=db.actor(auth.token);
  assert.equal(db.sale(actor,saleId).status,'confirmed');
  assert.equal(db.sale(actor,saleId).operational_status_id,null);
  assert.equal(db.sale(actor,saleId).payments.length,1);
  assert.equal(db.all('SELECT * FROM allocations WHERE tenant_id=?',actor.tenant_id).length,1);
  assert.equal(db.products(actor)[0].stock,1);
  assert.equal(db.all("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sale_statuses','sale_status_assignments')").length,2);
  const status=db.saveSaleStatus(actor,{name:'Novo fluxo',color:'blue'});
  assert.equal(db.setOperationalStatus(actor,saleId,{operational_status_id:status.id}).operational_status.name,'Novo fluxo');
});

test('permissão somente de edição não permite apagar custo com null nem mudar despesas', t => {
  const x=setup(t),seller=x.db.addUser(x.actor,{name:'V',email:'v@example.test',password:'senha-de-teste-456',permissions:['sales.edit_draft']});
  const saleId=draft(x,{seller_id:seller.id,items:[{description:'Avulso',quantity:1,unit_price_cents:10000,manual_cost_cents:5000}]});
  const v=x.db.actor(x.db.login({email:'v@example.test',password:'senha-de-teste-456'}).token), original=x.db.sale(x.actor,saleId).items[0];
  const base={customer_id:x.customer.id,seller_id:seller.id,items:[{id:original.id,description:'Avulso',quantity:1,unit_price_cents:10000}]};
  assert.throws(()=>x.db.saveDraft(v, {draft_token:x.db.operations.draftToken(v,saleId),...({...base,items:[{...base.items[0],manual_cost_cents:null}]})}, saleId),/permitido/);
  assert.throws(()=>x.db.saveDraft(v, {draft_token:x.db.operations.draftToken(v,saleId),...({...base,freight_cents:100})}, saleId),/permitido/);
  assert.equal(x.db.sale(x.actor,saleId).items[0].manual_cost_cents,5000);
});

test('conta Pix é isolada por loja, obrigatória e fotografada no pagamento idempotente', t => {
  const x = setup(t), account = x.db.savePixAccount(x.actor, { name: 'Pix da loja' });
  assert.deepEqual(x.db.snapshot(x.actor).pix_accounts, [{ id: account.id, name: 'Pix da loja', active: true }]);
  assert.throws(() => x.db.savePixAccount(x.actor, { name: 'PIX DA LOJA' }), error => error.status === 409);
  const saleId = draft(x), requestId = randomUUID();
  assert.throws(() => x.db.addPayment(x.actor, saleId, {
    request_id: randomUUID(), method: 'pix', amount_cents: 10000
  }), /Selecione a conta Pix/);
  const first = payment(x.db, x.actor, saleId, {
    method: 'pix', amount_cents: 10000, pix_account_id: account.id
  }, requestId);
  x.db.savePixAccount(x.actor, { name: 'Pix renomeado', active: false }, account.id);
  const replay = payment(x.db, x.actor, saleId, {
    method: 'pix', amount_cents: 10000, pix_account_id: account.id
  }, requestId);
  assert.equal(replay.replayed, true); assert.equal(replay.id, first.id);
  const photographed = x.db.sale(x.actor, saleId).payments[0];
  assert.equal(photographed.pix_account_id, account.id);
  assert.equal(photographed.pix_account_name, 'Pix da loja');
  const publicJson = JSON.stringify(x.db.public(x.db.share(x.actor, saleId).token));
  assert.ok(!publicJson.includes(account.id)); assert.ok(!publicJson.includes('Pix da loja'));
  assert.throws(() => payment(x.db, x.actor, draft(x), {
    method: 'pix', amount_cents: 1, pix_account_id: account.id
  }), /inativa/);

  const otherAccount = x.db.savePixAccount(x.actor, { name: 'Pix reserva' });
  assert.throws(() => payment(x.db, x.actor, saleId, {
    method: 'pix', amount_cents: 10000, pix_account_id: otherAccount.id
  }, requestId), error => error.status === 409);
  assert.throws(() => payment(x.db, x.actor, draft(x), {
    method: 'cash', amount_cents: 1, pix_account_id: otherAccount.id
  }), /só pode.*Pix/);
  const rate = x.db.saveRate(x.actor, { machine: 'M', brand: 'Visa', mode: 'credit', installments: 1, basis_points: 100 });
  assert.throws(() => payment(x.db, x.actor, draft(x), {
    method: 'card', amount_cents: 1, rate_id: rate.id, pix_account_id: otherAccount.id
  }), /não pode.*cartão/);

  const seller = x.db.addUser(x.actor, { name: 'Sem configuração', email: 'no-pix-settings@example.test',
    password: 'senha-de-teste-456', permissions: [] });
  const sellerActor = x.db.actor(x.db.login({ email: seller.email, password: 'senha-de-teste-456' }).token);
  assert.throws(() => x.db.savePixAccount(sellerActor, { name: 'Sem acesso' }), /permitido/);
  const other = x.db.actor(x.db.register({ name: 'Outro', store_name: 'Outra loja Pix',
    email: 'pix-other@example.test', password: 'senha-de-teste-456' }).token);
  assert.ok(x.db.savePixAccount(other, { name: 'Pix da loja' }).id);
  const otherSale = x.db.saveDraft(other, { items: [] }).id;
  assert.throws(() => payment(x.db, other, otherSale, {
    method: 'pix', amount_cents: 1, pix_account_id: otherAccount.id
  }), /não encontrado/);
});

test('fornecedor é fotografado na entrada e histórico respeita escopo e custos', t => {
  const x = setup(t), supplier = x.db.saveSupplier(x.actor, {
    name: 'Distribuidora A', email: 'COMPRAS@EXAMPLE.TEST', phone: '11999990000'
  });
  const firstEntry = x.db.receive(x.actor, { product_id: x.product.id, supplier_id: supplier.id,
    quantity: 5, unit_cost_cents: 4000 });
  x.db.receive(x.actor, { product_id: x.product.id, supplier_id: supplier.id,
    quantity: 3, unit_cost_cents: 6000 });
  x.db.saveSupplier(x.actor, { name: 'Distribuidora Renomeada' }, supplier.id);
  assert.equal(x.db.snapshot(x.actor).suppliers[0].name, 'Distribuidora Renomeada');
  assert.equal(x.db.snapshot(x.actor).suppliers[0].email, 'compras@example.test');

  const ownerSale = draft(x, { items: [{ product_id: x.product.id, quantity: 2, unit_price_cents: 10000 }] });
  x.db.confirm(x.actor, ownerSale, true);
  draft(x, { items: [{ product_id: x.product.id, quantity: 1, unit_price_cents: 10000 }] });
  const seller = x.db.addUser(x.actor, { name: 'Vendedor histórico', email: 'history-seller@example.test',
    password: 'senha-de-teste-456', permissions: [] });
  const sellerSale = draft(x, { seller_id: seller.id,
    items: [{ product_id: x.product.id, quantity: 1, unit_price_cents: 9000 }] });
  x.db.confirm(x.actor, sellerSale, true);

  const ownerHistory = x.db.productHistory(x.actor, x.product.id);
  const photographed = ownerHistory.entries.find(entry => entry.id === firstEntry.id);
  assert.equal(photographed.supplier_id, supplier.id);
  assert.equal(photographed.supplier_name, 'Distribuidora A');
  assert.equal(photographed.quantity_initial, 5); assert.equal(photographed.quantity_remaining, 2);
  assert.equal(photographed.unit_cost_cents, 4000);
  assert.equal(ownerHistory.sales.length, 2);
  assert.ok(ownerHistory.sales.every(sale => !Object.keys(sale).some(key => key.includes('cost'))));
  assert.equal(ownerHistory.product.fifo_cost_cents, 4000);
  assert.equal(ownerHistory.product.last_cost_cents, 6000);

  const sellerActor = x.db.actor(x.db.login({ email: seller.email, password: 'senha-de-teste-456' }).token);
  const restricted = x.db.productHistory(sellerActor, x.product.id);
  assert.equal(restricted.sales.length, 1); assert.equal(restricted.sales[0].sale_id, sellerSale);
  assert.ok(!('fifo_cost_cents' in restricted.product)); assert.ok(!('last_cost_cents' in restricted.product));
  assert.ok(restricted.entries.every(entry => !('unit_cost_cents' in entry)));
  assert.throws(() => x.db.saveSupplier(sellerActor, { name: 'Sem acesso' }), /permitido/);

  const stockUser = x.db.addUser(x.actor, { name: 'Estoquista', email: 'stock-supplier@example.test',
    password: 'senha-de-teste-456', permissions: ['stock.receive'] });
  const stockActor = x.db.actor(x.db.login({ email: stockUser.email, password: 'senha-de-teste-456' }).token);
  assert.ok(x.db.saveSupplier(stockActor, { name: 'Fornecedor autorizado' }).id);

  const other = x.db.actor(x.db.register({ name: 'Outro', store_name: 'Outra loja fornecedor',
    email: 'supplier-other@example.test', password: 'senha-de-teste-456' }).token);
  const otherProduct = x.db.addProduct(other, { name: 'Produto de outra loja', price_cents: 1 });
  assert.throws(() => x.db.receive(other, { product_id: otherProduct.id, supplier_id: supplier.id,
    quantity: 1, unit_cost_cents: 1 }), /não encontrado/);
  assert.throws(() => x.db.productHistory(other, x.product.id), /não encontrado/);
});

test('migração aditiva preserva Pix e lotes legados sem inventar catálogo', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'pdv-catalog-migration-')); let db;
  t.after(() => { db?.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); });
  const dbPath = join(dir, 'legacy.sqlite'); db = new Store(dbPath);
  const auth = db.register({ name: 'A', store_name: 'Loja legada', email: 'catalog-migration@example.test',
    password: 'senha-de-teste-456' });
  let actor = db.actor(auth.token);
  const product = db.addProduct(actor, { name: 'Produto legado', price_cents: 1000 });
  const lot = db.receive(actor, { product_id: product.id, quantity: 2, unit_cost_cents: 400 });
  const saleId = db.saveDraft(actor, { items: [] }).id, requestId = randomUUID();
  const account = db.savePixAccount(actor, { name: 'Será removida na simulação' });
  const recorded = payment(db, actor, saleId, { method: 'pix', amount_cents: 1000,
    pix_account_id: account.id }, requestId);
  const legacyHash = createHash('sha256').update(JSON.stringify({
    sale_id: saleId, method: 'pix', amount_cents: 1000, rate_id: null
  })).digest('hex');
  db.run('UPDATE payment_requests SET payload_hash=? WHERE tenant_id=? AND request_id=?', legacyHash, actor.tenant_id, requestId);
  db.db.exec(`PRAGMA foreign_keys=OFF;
    CREATE TABLE payments_legacy (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, sale_id TEXT NOT NULL,
      method TEXT NOT NULL, amount_cents INTEGER NOT NULL, machine TEXT, brand TEXT, mode TEXT,
      installments INTEGER, basis_points INTEGER NOT NULL DEFAULT 0, fee_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, FOREIGN KEY(tenant_id,sale_id) REFERENCES sales(tenant_id,id)
    );
    INSERT INTO payments_legacy SELECT id,tenant_id,sale_id,method,amount_cents,machine,brand,mode,
      installments,basis_points,fee_cents,created_at FROM payments;
    DROP TABLE payments; ALTER TABLE payments_legacy RENAME TO payments;
    CREATE TABLE lots_legacy (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, product_id TEXT NOT NULL,
      quantity_initial INTEGER NOT NULL, quantity_remaining INTEGER NOT NULL,
      unit_cost_cents INTEGER NOT NULL, received_at TEXT NOT NULL,
      FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id), UNIQUE(tenant_id,id)
    );
    INSERT INTO lots_legacy SELECT id,tenant_id,product_id,quantity_initial,quantity_remaining,unit_cost_cents,received_at FROM lots;
    DROP TABLE lots; ALTER TABLE lots_legacy RENAME TO lots;
    DROP TABLE pix_accounts; DROP TABLE suppliers; PRAGMA foreign_keys=ON;`);
  db.close(); db = null;

  db = new Store(dbPath); actor = db.actor(auth.token);
  assert.ok(db.all('PRAGMA table_info(payments)').some(column => column.name === 'pix_account_id'));
  assert.ok(db.all('PRAGMA table_info(lots)').some(column => column.name === 'supplier_id'));
  assert.equal(db.snapshot(actor).pix_accounts.length, 0); assert.equal(db.snapshot(actor).suppliers.length, 0);
  const legacyPayment = db.get('SELECT * FROM payments WHERE id=?', recorded.id);
  assert.equal(legacyPayment.pix_account_id, null); assert.equal(legacyPayment.pix_account_name, null);
  const legacyLot = db.get('SELECT * FROM lots WHERE id=?', lot.id);
  assert.equal(legacyLot.supplier_id, null); assert.equal(legacyLot.supplier_name, null);
  const replay = db.addPayment(actor, saleId, { request_id: requestId, method: 'pix', amount_cents: 1000 });
  assert.equal(replay.replayed, true); assert.equal(replay.id, recorded.id);
  assert.throws(() => db.addPayment(actor, saleId, {
    request_id: randomUUID(), method: 'pix', amount_cents: 1
  }), /Selecione a conta Pix/);
  const newAccount = db.savePixAccount(actor, { name: 'Pix novo' });
  payment(db, actor, saleId, { method: 'pix', amount_cents: 1, pix_account_id: newAccount.id });
  const supplier = db.saveSupplier(actor, { name: 'Fornecedor novo' });
  db.receive(actor, { product_id: product.id, supplier_id: supplier.id, quantity: 1, unit_cost_cents: 500 });
  assert.equal(db.all('PRAGMA foreign_key_check').length, 0);
});
