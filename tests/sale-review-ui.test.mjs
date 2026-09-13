import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { salesRecords } from '../public/sales-view.mjs';

const app = readFileSync(new URL('../public/app.mjs', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/brand.css', import.meta.url), 'utf8');
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function source(from, to) {
  const start = app.indexOf(from), end = app.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `Trecho ausente: ${from}`);
  return app.slice(start, end);
}

test('interface A conferir: automático e manual são visíveis sem substituir status operacional', () => {
  const ctx = { esc, can: () => true };
  runInNewContext(source('function reviewBadge(', 'function operationalStatusControl('), ctx);
  const automatic = { id: 'sale', number: 7, status: 'confirmed', review: { manual: false, automatic: true, required: true } };
  const manual = { ...automatic, review: { manual: true, automatic: false, required: true } };
  assert.match(ctx.reviewBadge(automatic), /A conferir<small>automático/);
  assert.match(ctx.saleReviewControl(automatic), /data-sale-review="sale"[^>]*data-previous="false"/);
  assert.doesNotMatch(ctx.saleReviewControl(automatic), /type="checkbox"[^>]*checked/);
  assert.match(ctx.saleReviewControl(manual), /type="checkbox"[^>]*checked/);
  assert.match(ctx.saleReviewControl(manual), /<small>manual<\/small>/);
  assert.match(ctx.saleReviewControl(automatic), /class="sale-review-status is-required is-automatic"/);
  assert.doesNotMatch(ctx.saleReviewControl(automatic), /sale-review-badge/);
  assert.equal((ctx.saleReviewControl(automatic).match(/<span>A conferir<\/span>/g) ?? []).length, 1);
  assert.equal(ctx.reviewBadge({ ...automatic, status: 'cancelled' }), '');
  ctx.can = () => false;
  assert.doesNotMatch(ctx.saleReviewControl(manual), /type="checkbox"/);
  assert.match(ctx.saleReviewControl(manual), /A conferir/);
});

test('interface A conferir: card abre a lista filtrada e Vendas continua sem cards', () => {
  const dashboard = source('function renderDashboard()', 'function renderSales()');
  const sales = source('function renderSales()', 'const productNameButton');
  assert.match(dashboard, /reviewMetric\(String\(d\.incomplete_sales\)\)/);
  assert.match(app, /data-action="show-review-sales"/);
  assert.match(app, /filter=\{\.\.\.filter,review:'required'\}/);
  assert.doesNotMatch(sales, /metric-grid|reviewMetric/);
  assert.match(app, /name="review" aria-label="Filtrar vendas a conferir"/);
  assert.match(app, /option\('required','A conferir',filter\.review\)/);
  assert.match(css, /\.metric-action/);
});

test('interface A conferir: marcação na lista grava, atualiza totais e restaura em falha', async () => {
  for (const failure of [false, true]) {
    const calls = [], el = { dataset: { saleReview: 'sale', previous: 'false' }, checked: true, disabled: false, isConnected: true };
    const ctx = {
      el, busy: false, view: 'sales', detailSale: null, detailId: null,
      state: { sales: [{ id: 'sale', edit_token: 'fresh-token' }] }, salesMutationRefreshPending: false,
      salesFilters: { clear: () => calls.push('clear') },
      api: async (path, data, method) => { calls.push({ path, data, method }); if (failure) throw Error('Falha de teste'); },
      load: async () => calls.push('load'), render: () => calls.push('render'), toast: text => calls.push(text)
    };
    const block = source(' if(el.dataset.saleReview!==undefined){', " if(view!=='editor')return;");
    await runInNewContext(`(async()=>{${block}})()`, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { path: '/sales/sale/review', data: { review_manual: true, edit_token: 'fresh-token' }, method: 'PUT' });
    assert.equal(ctx.busy, false); assert.equal(el.disabled, false);
    if (failure) { assert.equal(el.checked, false); assert.equal(ctx.salesMutationRefreshPending, false); assert.equal(calls.at(-1), 'Falha de teste'); }
    else { assert.equal(el.dataset.previous, 'true'); assert.deepEqual(calls.slice(1), ['load', 'render', 'Venda marcada para conferir.']); }
  }
});

test('interface A conferir: editor leva a escolha manual e a lista chama o controle próprio', () => {
  assert.match(app, /data-bind="review_manual"/);
  assert.match(app, /data\.review_manual=!!w\.review_manual/);
  assert.match(app, /original_review_manual=w\.review_manual/);
  const record = { id: 's', number: 1, status: 'confirmed', items: [], reconciliation: { gross_cents: 0, pending_cents: 0, excess_cents: 0 }, review: { required: true } };
  const html = salesRecords([record], {
    esc, money: String, date: String, can: () => false, statusBadge: () => '', paymentBadge: () => '',
    operationalStatusControl: () => '<span>Separação</span>', reviewControl: () => '<span>A conferir</span>', empty: () => ''
  });
  assert.match(html, /sale-record-status-group[^>]*role="group"[^>]*>[\s\S]*sale-record-status-items[^>]*>[\s\S]*Separação<\/span><span>A conferir/);
  const editorStatus = source('function editorSaleStatusField(', 'async function saveCustomerForm(');
  assert.match(editorStatus, /Status da venda[\s\S]*operational[\s\S]*saleReviewEditor\(w\)/);
  const detail = source('function renderDetail()', 'function showCancellationRefresh()');
  assert.match(detail, /sale-state-summary[\s\S]*Status da venda[\s\S]*statusBadge\(s\)[\s\S]*paymentBadge\(s\)[\s\S]*saleReviewControl\(s,'detalhe'\)/);
  assert.doesNotMatch(detail, /<span>Conferência<\/span>/);
});

test('lista de vendas: status compacto e três ações permanecem alinhados dentro do cartão', () => {
  const record = { id: 's', number: 8, status: 'confirmed', items: [], total_cents: 0, reconciliation: { gross_cents: 0, pending_cents: 0, excess_cents: 0 }, review: { required: false } };
  const html = salesRecords([record], {
    esc, money: String, date: String, can: () => true, statusBadge: () => '<span>Confirmada</span>', paymentBadge: () => '<span>Pago</span>',
    operationalStatusControl: () => '<span>Status operacional</span>', reviewControl: () => '<span>A conferir</span>', empty: () => ''
  });
  const actions = html.match(/<div class="row-actions sale-record-actions">([\s\S]*?)<\/div><\/footer>/)?.[1] ?? '';
  assert.equal((actions.match(/data-action=/g) ?? []).length, 3);
  assert.match(css, /\.sale-record-footer>\.sale-record-actions\s*\{[^}]*display:\s*grid[^}]*grid-auto-flow:\s*column[^}]*grid-auto-columns:\s*minmax\(0,1fr\)/);
  assert.match(css, /\.sale-record-actions>button\s*\{[^}]*min-width:\s*0[^}]*white-space:\s*normal/);
  assert.match(css, /\.sale-review-status\s*\{[^}]*min-height:\s*32px/);
  assert.match(css, /\.sale-review-status:has\(input:focus-visible\)/);
});
