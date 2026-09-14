import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.mjs', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/brand.css', import.meta.url), 'utf8');
const stockMarkup = app.slice(app.indexOf('function stockBalanceMarkup()'), app.indexOf('function updateStockResults()'));

test('estoque compacto: nome e quantidade formam a primeira linha sem situação redundante', () => {
  assert.match(stockMarkup, /<th>Produto<\/th><th class="num">Estoque<\/th>/);
  assert.match(stockMarkup, /productNameButton\(p,'stock'\)[\s\S]*stock-balance-cell/);
  assert.doesNotMatch(stockMarkup, /<th>Situação<\/th>|Disponível/);
  assert.match(css, /\.compact-stock-table>tbody>tr\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(css, /\.compact-stock-table>tbody>tr>\.stock-balance-cell\s*\{[^}]*grid-column:2/);
});

test('estoque compacto: mantém alertas úteis para saldo zero e negativo e preserva custos', () => {
  assert.match(stockMarkup, /p\.stock<0\?'[^']*Entrada e custo pendentes/);
  assert.match(stockMarkup, /p\.stock===0\?'[^']*Sem saldo/);
  assert.match(stockMarkup, /costs\?`<td class="num stock-cost-cell">\$\{costValue\(p\.fifo_cost_cents\)\}/);
  assert.match(stockMarkup, /productNameButton\(p,'stock'\)/);
});
