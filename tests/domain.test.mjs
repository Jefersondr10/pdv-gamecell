import test from 'node:test';
import assert from 'node:assert/strict';
import { feeCents, reconcile, planFIFO, saleTotal, businessDate, publicSale, integer } from '../src/domain.mjs';

test('pagamentos brutos conferem, mesmo com taxas', () => {
  const r = reconcile(100000, [{ amount_cents: 100000, fee_cents: 4000 }]);
  assert.equal(r.state, 'matched'); assert.equal(r.net_cents, 96000); assert.equal(r.pending_cents, 0);
});
test('pagamento menor gera pendência', () => {
  assert.equal(reconcile(100000, [{ amount_cents: 80000 }]).pending_cents, 20000);
});
test('pagamento maior é excesso, não receita extra', () => {
  const r = reconcile(100000, [{ amount_cents: 110000 }]);
  assert.equal(r.total_cents, 100000); assert.equal(r.excess_cents, 10000); assert.equal(r.state, 'overpaid');
});
test('divisão Pix, dinheiro e cartão', () => {
  const r = reconcile(100000, [{ amount_cents: 40000 }, { amount_cents: 10000 }, { amount_cents: 50000, fee_cents: 2000 }]);
  assert.equal(r.state, 'matched'); assert.equal(r.net_cents, 98000);
});
test('arredondamento half-up por pagamento', () => {
  assert.equal(feeCents(101, 500), 5); assert.equal(feeCents(10, 500), 1); assert.equal(feeCents(50000, 400), 2000);
});
test('valores fracionários, negativos e não seguros são rejeitados', () => {
  for (const v of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => integer(v, 'Valor'));
  assert.throws(() => feeCents(100, 10001));
});
test('FIFO atravessa lotes sem mudar a entrada original', () => {
  const lots = [{ id: 'a', quantity_remaining: 2, unit_cost_cents: 10000 }, { id: 'b', quantity_remaining: 3, unit_cost_cents: 12000 }];
  const p = planFIFO(lots, 3); assert.equal(p.known_cost_cents, 32000);
  assert.deepEqual(p.allocations.map(a => a.quantity), [2, 1]); assert.equal(lots[0].quantity_remaining, 2);
});
test('falta de estoque mantém custo desconhecido, não zero', () => {
  const p = planFIFO([{ id: 'a', quantity_remaining: 1, unit_cost_cents: 10000 }], 3);
  assert.equal(p.pending_quantity, 2); assert.equal(p.allocations[1].unit_cost_cents, null);
});
test('total usa preço da venda, sem pagamentos', () => {
  assert.equal(saleTotal([{ quantity: 2, unit_price_cents: 12345 }]), 24690);
});
test('data comercial respeita São Paulo à meia-noite UTC', () => {
  assert.equal(businessDate(new Date('2026-09-06T01:30:00Z')), '2026-09-05');
});
