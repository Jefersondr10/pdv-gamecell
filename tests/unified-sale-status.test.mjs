import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';

function setup(t) {
  const db = new Store();
  t.after(() => db.close());
  const session = db.register({
    name: 'Administrador', store_name: 'Status unificado',
    email: `status-${randomUUID()}@example.test`, password: 'senha-ficticia-de-teste'
  });
  const actor = db.actor(session.token);
  const customer = db.addCustomer(actor, { name: 'Cliente' });
  const product = db.addProduct(actor, { name: 'Produto', price_cents: 1_000 });
  db.receive(actor, { product_id: product.id, quantity: 5, unit_cost_cents: 500 });
  return { db, actor, customer, product };
}

function sale(x, paid = 1_000) {
  const id = x.db.saveDraft(x.actor, {
    customer_id: x.customer.id, seller_id: x.actor.id,
    review_manual: false,
    items: [{ product_id: x.product.id, quantity: 1, unit_price_cents: 1_000 }]
  }).id;
  if (paid) x.db.addPayment(x.actor, id, { method: 'cash', amount_cents: paid, request_id: randomUUID() });
  x.db.confirm(x.actor, id, true);
  return id;
}

test('status unificado alterna A conferir e status cadastrado de forma atômica', t => {
  const x = setup(t), id = sale(x);
  const separating = x.db.saveSaleStatus(x.actor, { name: 'Em separação', color: 'blue' });
  const ready = x.db.saveSaleStatus(x.actor, { name: 'Pronto', color: 'green' });
  let current = x.db.setOperationalStatus(x.actor, id, { operational_status_id: separating.id });

  const marked = x.db.setOperationalStatus(x.actor, id, {
    operational_status_id: null, review_manual: true, edit_token: current.edit_token
  });
  assert.equal(marked.review.manual, true);
  assert.equal(marked.review.required, true);
  assert.equal(marked.operational_status_id, separating.id, 'o fluxo anterior fica preservado enquanto A conferir está visível');
  assert.throws(() => x.db.setOperationalStatus(x.actor, id, {
    operational_status_id: ready.id, review_manual: false, edit_token: current.edit_token
  }), /mudou em outra tela/);

  current = x.db.setOperationalStatus(x.actor, id, {
    operational_status_id: ready.id, review_manual: false, edit_token: marked.edit_token
  });
  assert.equal(current.review.manual, false);
  assert.equal(current.review.required, false);
  assert.equal(current.operational_status_id, ready.id);
  assert.equal(x.db.get("SELECT COUNT(*) AS n FROM audit WHERE entity='sale' AND entity_id=? AND action='review_manual_changed'", id).n, 2);
  assert.equal(x.db.get("SELECT COUNT(*) AS n FROM audit WHERE entity='sale' AND entity_id=? AND action='operational_status_changed'", id).n, 2);
});

test('pendência automática continua A conferir mesmo após escolher outro andamento', t => {
  const x = setup(t), id = sale(x, 400);
  const ready = x.db.saveSaleStatus(x.actor, { name: 'Pronto', color: 'green' });
  const before = x.db.sale(x.actor, id);
  const after = x.db.setOperationalStatus(x.actor, id, {
    operational_status_id: ready.id, review_manual: false, edit_token: before.edit_token
  });
  assert.equal(after.operational_status_id, ready.id);
  assert.equal(after.review.manual, false);
  assert.equal(after.review.automatic, true);
  assert.equal(after.review.required, true);
  assert.deepEqual(after.review.reasons, ['payment_mismatch']);
});

test('status unificado rejeita combinações ambíguas e preserva contrato antigo', t => {
  const x = setup(t), id = sale(x);
  const status = x.db.saveSaleStatus(x.actor, { name: 'Separado', color: 'blue' });
  let current = x.db.sale(x.actor, id);
  assert.throws(() => x.db.setOperationalStatus(x.actor, id, {
    operational_status_id: status.id, review_manual: true, edit_token: current.edit_token
  }), /não pode ser combinada/);
  current = x.db.setOperationalStatus(x.actor, id, { operational_status_id: status.id });
  assert.equal(current.operational_status_id, status.id);
  assert.equal(current.review.manual, false);
});

test('A conferir manual continua visível depois de recarregar um rascunho', t => {
  const x = setup(t);
  const draft = x.db.saveDraft(x.actor, {
    customer_id: x.customer.id,
    seller_id: x.actor.id,
    review_manual: true,
    items: [{ product_id: x.product.id, quantity: 1, unit_price_cents: 1_000 }]
  });

  const reloaded = x.db.sale(x.actor, draft.id);
  assert.equal(reloaded.status, 'draft');
  assert.equal(reloaded.review.manual, true);
  assert.equal(reloaded.review.automatic, false);
  assert.equal(reloaded.review.required, true);
});
