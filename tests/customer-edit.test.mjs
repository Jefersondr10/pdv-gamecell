import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';

function setup(t) {
  const db = new Store(); t.after(() => db.close());
  const actor = db.actor(db.register({ name: 'Administrador', store_name: 'Clientes teste', email: 'customer-edit@example.test', password: 'senha-ficticia-de-teste' }).token);
  const customer = db.addCustomer(actor, { name: 'Cliente original', email: 'original@example.test', phone: '(11) 99999-0000', cpf: '529.982.247-25' });
  return { db, actor, customer };
}
const edit = (x, data) => x.db.updateCustomer(x.actor, x.customer.id, { edit_token: x.db.customer(x.actor, x.customer.id).edit_token, ...data });
const history = x => x.db.all("SELECT * FROM audit WHERE tenant_id=? AND entity='customer' AND entity_id=? ORDER BY rowid", x.actor.tenant_id, x.customer.id);

test('cliente: edição normaliza dados e registra antes/depois com identidade e token preservados corretamente', t => {
  const x = setup(t), original = x.db.customer(x.actor, x.customer.id);
  assert.match(original.edit_token, /^[a-f0-9]{64}$/); assert.equal(original.tenant_id, undefined); assert.equal(original.created_at, undefined);
  const changed = edit(x, { name: ' Cliente corrigido ', email: 'CORRIGIDO@EXAMPLE.TEST', phone: ' 11988887777 ', cpf: '111.444.777-35' });
  assert.deepEqual({ ...changed, edit_token: undefined }, { id: x.customer.id, name: 'Cliente corrigido', email: 'corrigido@example.test', phone: '11988887777', cpf: '11144477735', edit_token: undefined });
  assert.notEqual(changed.edit_token, original.edit_token);
  const records = history(x); assert.equal(records.length, 2); assert.equal(records[1].action, 'updated'); assert.equal(records[1].actor_id, x.actor.id);
  const audit = JSON.parse(records[1].data_json); assert.equal(audit.before.name, x.customer.name); assert.equal(audit.after.cpf, changed.cpf);
  assert.equal(x.db.snapshot(x.actor).customers[0].name, changed.name);
});

test('cliente: omissões preservam campos, vazio limpa opcionais e reenvio sem alteração não duplica auditoria', t => {
  const x = setup(t), nameOnly = edit(x, { name: 'Novo nome' });
  assert.equal(nameOnly.email, x.customer.email); assert.equal(nameOnly.phone, x.customer.phone); assert.equal(nameOnly.cpf, x.customer.cpf);
  const empty = edit(x, { email: '', phone: '', cpf: '' }); assert.equal(empty.name, 'Novo nome'); assert.equal(empty.email, ''); assert.equal(empty.phone, ''); assert.equal(empty.cpf, '');
  const before = history(x); assert.deepEqual(edit(x, {}), empty); assert.deepEqual(history(x), before);
});

test('cliente: validação de nome/CPF/e-mail/telefone falha atomicamente e criação valida e-mail opcional', t => {
  const x = setup(t), original = x.db.customer(x.actor, x.customer.id), before = history(x);
  for (const data of [{ name: '' }, { name: 'a'.repeat(201) }, { cpf: '11111111111' }, { cpf: '52998224726' }, { email: 'email-invalido' }, { phone: '1'.repeat(41) }, { phone: 123 }, { email: {} }]) {
    assert.throws(() => edit(x, data), error => error.status === 400);
    assert.deepEqual(x.db.customer(x.actor, x.customer.id), original); assert.deepEqual(history(x), before);
  }
  assert.throws(() => x.db.addCustomer(x.actor, { name: 'Não criado', email: 'email-invalido' }), /E-mail inválido/);
  assert.equal(x.db.addCustomer(x.actor, { name: 'Sem contato' }).email, '');
  assert.equal(x.db.addCustomer(x.actor, { name: 'Contato', email: 'UPPER@EXAMPLE.TEST' }).email, 'upper@example.test');
});

test('cliente: concorrência rejeita token ausente, antigo, de outro cadastro e alterações revertidas', t => {
  const x = setup(t), original = x.db.customer(x.actor, x.customer.id);
  assert.throws(() => x.db.updateCustomer(x.actor, x.customer.id, { name: 'Sem token' }), error => error.status === 409);
  const other = x.db.addCustomer(x.actor, { name: 'Outro cliente' });
  assert.throws(() => x.db.updateCustomer(x.actor, other.id, { edit_token: original.edit_token, name: 'Token cruzado' }), error => error.status === 409);
  edit(x, { name: 'Alterado' });
  assert.throws(() => x.db.updateCustomer(x.actor, x.customer.id, { edit_token: original.edit_token, phone: '11999990000' }), error => error.status === 409);
  edit(x, { name: original.name });
  assert.throws(() => x.db.updateCustomer(x.actor, x.customer.id, { edit_token: original.edit_token, name: 'Formulário antigo' }), error => error.status === 409);
});

test('cliente: consulta/edição isoladas por loja e token restrito à permissão de gerenciar clientes', t => {
  const x = setup(t), restricted = { ...x.actor, is_owner: false, permissions: [] };
  assert.deepEqual(x.db.customer(restricted, x.customer.id), x.customer);
  assert.throws(() => x.db.updateCustomer(restricted, x.customer.id, { name: 'Sem permissão' }), error => error.status === 403);
  const other = x.db.actor(x.db.register({ name: 'Outro administrador', store_name: 'Outra loja', email: 'customer-edit-other@example.test', password: 'senha-ficticia-de-teste' }).token);
  assert.throws(() => x.db.customer(other, x.customer.id), error => error.status === 404);
  assert.throws(() => x.db.updateCustomer(other, x.customer.id, { edit_token: x.db.customer(x.actor, x.customer.id).edit_token, name: 'Outra loja' }), error => error.status === 404);
});

test('cliente: falha de auditoria desfaz alteração e vendas, pagamentos, estoque e fonte financeira permanecem intactos', t => {
  const x = setup(t), product = x.db.addProduct(x.actor, { name: 'Aparelho', price_cents: 1000 });
  x.db.receive(x.actor, { product_id: product.id, quantity: 2, unit_cost_cents: 200 });
  const key = x.db.saveDraft(x.actor, { customer_id: x.customer.id, seller_id: x.actor.id, business_date: '2026-08-03', items: [{ product_id: product.id, quantity: 1, unit_price_cents: 1000 }] }).id;
  x.db.addPayment(x.actor, key, { method: 'cash', amount_cents: 1000, request_id: randomUUID() }); x.db.confirm(x.actor, key, true);
  const tables = ['sales', 'sale_items', 'payments', 'payment_changes', 'allocations', 'lots', 'sale_fifo_order'];
  const records = tables.map(table => x.db.all(`SELECT * FROM ${table}`)), finance = x.db.finance.calculate(x.actor, '2026-08').source_hash;
  const original = x.db.customer(x.actor, x.customer.id), audits = history(x);
  x.db.db.exec("CREATE TRIGGER fail_customer_audit BEFORE INSERT ON audit WHEN NEW.entity='customer' AND NEW.action='updated' BEGIN SELECT RAISE(ABORT,'audit failure'); END;");
  assert.throws(() => edit(x, { name: 'Falhou' }), /audit failure/);
  assert.deepEqual(x.db.customer(x.actor, x.customer.id), original); assert.deepEqual(history(x), audits);
  x.db.db.exec('DROP TRIGGER fail_customer_audit'); edit(x, { name: 'Cliente revisado' });
  assert.deepEqual(tables.map(table => x.db.all(`SELECT * FROM ${table}`)), records);
  assert.equal(x.db.finance.calculate(x.actor, '2026-08').source_hash, finance);
  assert.equal(x.db.sale(x.actor, key).customer_name, 'Cliente revisado'); assert.equal(x.db.sale(x.actor, key).total_cents, 1000);
  const shared = x.db.public(x.db.share(x.actor, key).token); assert.equal(shared.customer, 'Cliente revisado');
  assert.doesNotMatch(JSON.stringify(shared), /52998224725|original@example\.test|edit_token/);
  assert.deepEqual(x.db.all('PRAGMA foreign_key_check'), []);
});
