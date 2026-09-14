import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { rankingView } from '../public/ranking-ui.mjs';

const app = readFileSync(new URL('../public/app.mjs', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/brand.css', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');

function source(from, to) {
  const start = app.indexOf(from), end = app.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `Trecho ausente: ${from}`);
  return app.slice(start, end);
}

function functionSource(name) {
  const marker = `function ${name}(`, start = app.indexOf(marker);
  assert.ok(start >= 0, `Função ausente: ${name}`);
  const tail = app.slice(start + marker.length);
  const next = tail.search(/\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/);
  return app.slice(start, next < 0 ? app.length : start + marker.length + next);
}

test('Ranking tem rota própria, usa as vendas filtradas e não permanece no Dashboard', () => {
  assert.match(app, /import\s*\{[^}]*rankingView[^}]*\}\s*from\s*['"]\.\/ranking-ui\.mjs['"]/);
  assert.match(server, /\['\/ranking-ui\.mjs',\s*\['ranking-ui\.mjs',\s*'text\/javascript; charset=utf-8'\]\]/);
  const dashboard = functionSource('renderDashboard');
  const ranking = functionSource('renderRanking');
  const render = functionSource('render');
  assert.doesNotMatch(dashboard, /sellerRanking\(|rankingView\(|Ranking por faturamento/);
  assert.match(ranking, /filters\(\)/);
  assert.match(ranking, /rankingView\(state\.sales\s*,/);
  assert.match(ranking, /can\(['"]profit\.view['"]\)/);
  assert.match(render, /view\s*===\s*['"]ranking['"]\)\s*renderRanking\(\)/);
});

test('abas Vendedores, Produtos e Dias são trocadas dentro da página', () => {
  assert.match(app, /\[data-ranking-tab\]/);
  assert.match(app, /dataset\.rankingTab/);
  assert.match(app, /rankingTab\s*=\s*(?:button|rankingButton)\.dataset\.rankingTab/);
  assert.match(css, /\.ranking-page\b/);
  assert.match(css, /\.ranking-tabs\b/);
  assert.match(css, /\.ranking-panel\b/);
  assert.match(css, /@media screen and \(max-width:\s*700px\)[\s\S]*\.ranking-(?:page|row|values|tabs)\b/);
});

test('ranking permite ordenar por faturamento, lucro e número de vendas', () => {
  const sales = [{
    id: 'sale', status: 'confirmed', seller_id: 'seller', seller_name: 'Vendedora',
    business_date: '2026-09-13', total_cents: 10000, profit_cents: 2500,
    items: [{ product_id: 'product', description: 'Console', total_cents: 10000, profit_cents: 2500 }]
  }];
  const allowed = rankingView(sales, { canViewProfit: true });
  assert.match(allowed, /data-ranking-metric="revenue"[^>]*>Faturamento<\/button>/);
  assert.match(allowed, /data-ranking-metric="profit"[^>]*>Lucro<\/button>/);
  assert.match(allowed, /data-ranking-metric="sales"[^>]*>Nº de vendas<\/button>/);
  const restricted = rankingView(sales, { canViewProfit: false });
  assert.doesNotMatch(restricted, /data-ranking-metric="profit"|>Lucro<\/button>/);
  assert.match(app, /\[data-ranking-tab\],\[data-ranking-metric\]/);
  assert.match(app, /dataset\.rankingMetric/);
  assert.match(app, /rankingMetric\s*=\s*(?:button|rankingButton)\.dataset\.rankingMetric/);
});

test('filtros automáticos continuam ativos quando a tela atual é Ranking', () => {
  let options;
  const ctx = {
    createSalesFilterController(value) { options = value; return {}; },
    applySalesFilters() {}, busy: false, saoPauloToday: () => '2026-09-13',
    state: { user: { id: 'owner' } }, view: 'ranking', salesMutationRefreshPending: false,
    cancellationRefreshPending: false, salesRefreshPending: false,
    document: { querySelector: () => null }, toast() {}
  };
  runInNewContext(source('const salesFilters=createSalesFilterController(', 'const stockUI='), ctx);
  const form = { dataset: { filterOwner: 'owner' } };
  assert.equal(options.isCurrent(form), true);
  ctx.view = 'dashboard'; assert.equal(options.isCurrent(form), true);
  ctx.view = 'sales'; assert.equal(options.isCurrent(form), true);
  ctx.view = 'products'; assert.equal(options.isCurrent(form), false);
  ctx.view = 'ranking'; ctx.salesMutationRefreshPending = true;
  assert.equal(options.isCurrent(form), false);
});

test('abrir Ranking atualiza primeiro uma consulta de vendas que ficou pendente', async () => {
  const calls = [], fresh = { user: { id: 'owner' }, sales: [] };
  const ctx = {
    button: { dataset: { view: 'ranking' } }, view: 'customers', salesRefreshPending: true,
    filter: { date_preset: 'all', sale_type: 'wholesale', q: 'Console' }, URLSearchParams,
    rememberWorking: () => calls.push('remember'), api: async path => { calls.push(path); return fresh; },
    adoptState: state => calls.push(state), salesFilters: { clear: () => calls.push('clear') },
    working: { id: 'draft' }, workingDirty: true, expenseMenuOpen: false,
    render: () => calls.push('render'), busy: false
  };
  await runInNewContext(`(async()=>{${source(' if(button.dataset.view){', ' const a=button.dataset.action')}})()`, ctx);
  assert.equal(ctx.view, 'ranking');
  assert.equal(ctx.salesRefreshPending, false);
  assert.match(calls[1], /^\/state\?/);
  const query = new URLSearchParams(calls[1].split('?')[1]);
  assert.equal(query.get('date_preset'), 'all');
  assert.equal(query.get('sale_type'), 'wholesale');
  assert.equal(query.get('q'), 'Console');
  assert.equal(calls[2], fresh);
  assert.deepEqual(calls.slice(-2), ['clear', 'render']);
});
