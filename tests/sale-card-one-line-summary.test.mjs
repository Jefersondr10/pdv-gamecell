import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { salesRecords } from '../public/sales-view.mjs';

const css = readFileSync(new URL('../public/brand.css', import.meta.url), 'utf8');
const esc = value => String(value ?? '');

test('card mobile mantém Venda, Custo e Lucro em uma única faixa clicável', () => {
  const sale = {
    id: 'sale-1', number: 1, status: 'confirmed', customer_name: 'Cliente',
    business_date: '2026-09-13', registered_at: '2026-09-13T14:30:00-03:00',
    total_cents: 99999999, known_cost_cents: 70000000, freight_cents: 0,
    expenses: [], pending_cost_quantity: 0, profit_cents: 29999999,
    reconciliation: { state: 'matched', fee_cents: 0 }
  };
  const html = salesRecords([sale], {
    esc, money: cents => `R$ ${cents}`, date: () => '13/09/2026', time: () => '14:30',
    can: () => true, statusBadge: () => '', paymentBadge: () => '',
    operationalStatusControl: () => '<span>Concluída</span>', empty: () => ''
  });

  assert.match(html, /<div class="sale-record-overview"><button[^>]*class="sale-record-open-button"[^>]*data-action="open-sale"[^>]*>/);
  assert.match(html, /sale-record-compact-values values-3[\s\S]*<small>Venda<\/small>[\s\S]*<small>Custo total<\/small>[\s\S]*<small>Lucro<\/small>/);
  assert.equal((html.match(/class="sale-record-compact-values values-3"/g) ?? []).length, 1);
  assert.match(css, /\.sale-record-compact-values\s*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)[^}]*width:100%[^}]*overflow:hidden/);
  assert.match(css, /\.sale-record-compact-values>span\s*\{[^}]*min-width:0[^}]*overflow:hidden/);
  assert.match(css, /@media screen and \(max-width:700px\)[\s\S]*?\.sale-record-compact-values\s*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.sale-record-compact\s*\{[^}]*border-left:4px solid #087d98[^}]*box-shadow/);
});

test('card clicável mantém os textos visíveis ao passar o mouse', () => {
  assert.match(css, /\.sale-record-open-button\s*\{[^}]*background:transparent[^}]*box-shadow:none/);
  assert.match(css, /\.sale-record-open-button:hover,\.sale-record-open-button:active\s*\{[^}]*background:transparent[^}]*border-color:transparent[^}]*box-shadow:none/);
});
