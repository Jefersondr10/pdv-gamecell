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

test('interface A conferir: aparece como uma opção do mesmo seletor de status', () => {
  assert.match(app, /const reviewStatusValue='__review__'/);
  assert.match(app, /unifiedStatusOptions = selected => option\('','Sem status',selected\)\+option\(reviewStatusValue,'A conferir',selected\)/);
  assert.match(app, /const selected=unifiedStatusValue\(s\)/);
  assert.match(app, /selected===reviewStatusValue\?'[^']*A conferir/);
  assert.doesNotMatch(source('function renderSales()', 'const productNameButton'), /reviewControl:saleReviewControl/);
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

test('interface A conferir: seletor único grava status e conferência juntos por PUT', async () => {
  for (const failure of [false, true]) {
    const calls = [], el = { dataset: { saleStatus: 'sale', previous: 'status-anterior' }, value: '__review__', disabled: false, isConnected: true };
    const ctx = {
      el, busy: false, view: 'sales', detailSale: null, detailId: null, reviewStatusValue: '__review__',
      state: { sales: [{ id: 'sale', edit_token: 'fresh-token' }] }, salesMutationRefreshPending: false,
      salesFilters: { clear: () => calls.push('clear') },
      api: async (path, data, method) => { calls.push({ path, data, method }); if (failure) throw Error('Falha de teste'); },
      load: async () => calls.push('load'), render: () => calls.push('render'), toast: text => calls.push(text)
    };
    const block = source(' if(el.dataset.saleStatus!==undefined){', ' if(el.dataset.saleReview!==undefined){');
    await runInNewContext(`(async()=>{${block}})()`, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { path: '/sales/sale/status', data: { operational_status_id: null, review_manual: true, edit_token: 'fresh-token' }, method: 'PUT' });
    assert.equal(ctx.busy, false); assert.equal(el.disabled, false);
    if (failure) { assert.equal(el.value, 'status-anterior'); assert.equal(ctx.salesMutationRefreshPending, false); assert.equal(calls.at(-1), 'Falha de teste'); }
    else { assert.equal(el.dataset.previous, '__review__'); assert.deepEqual(calls.slice(1), ['load', 'render', 'Venda marcada para conferir.']); }
  }
});

test('interface A conferir: andamento salvo mantém aviso automático visível', async () => {
  const calls = [], el = { dataset: { saleStatus: 'sale', previous: '__review__' }, value: 'separacao', disabled: false, isConnected: true };
  const ctx = {
    el, busy: false, view: 'sales', detailSale: null, detailId: null, reviewStatusValue: '__review__',
    state: { sales: [{ id: 'sale', edit_token: 'fresh-token', review: { automatic: true } }] }, salesMutationRefreshPending: false,
    salesFilters: { clear() {} }, api: async (...args) => calls.push(args), load: async () => {}, render: () => {}, toast: text => calls.push(text)
  };
  const block = source(' if(el.dataset.saleStatus!==undefined){', ' if(el.dataset.saleReview!==undefined){');
  await runInNewContext(`(async()=>{${block}})()`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['/sales/sale/status', { operational_status_id: 'separacao', review_manual: false, edit_token: 'fresh-token' }, 'PUT']);
  assert.equal(calls.at(-1), 'Andamento salvo; continua A conferir até resolver os avisos.');
});

test('interface A conferir: editor e lista não renderizam um segundo controle', () => {
  assert.match(app, /data-editor-sale-status/);
  assert.match(app, /working\.review_manual=review/);
  assert.match(app, /working\.review_automatic\)toast\('Andamento escolhido; a venda continua A conferir até resolver os avisos\.'/);
  assert.match(app, /data\.review_manual=!!w\.review_manual/);
  assert.match(app, /original_review_manual=w\.review_manual/);
  const record = { id: 's', number: 1, status: 'confirmed', items: [], reconciliation: { gross_cents: 0, pending_cents: 0, excess_cents: 0 }, review: { required: true } };
  const html = salesRecords([record], {
    esc, money: String, date: String, time: () => '', can: () => false, statusBadge: () => '', paymentBadge: () => '',
    operationalStatusControl: () => '<span>Separação ou A conferir</span>', reviewControl: () => '<span>CONTROLE DUPLICADO</span>', empty: () => ''
  });
  assert.match(html, /sale-record-compact-status[^>]*aria-label="Status da venda"[^>]*>[\s\S]*Separação ou A conferir/);
  assert.doesNotMatch(html, /CONTROLE DUPLICADO/);
  const editorStatus = source('function editorSaleStatusField(', 'async function saveCustomerForm(');
  assert.match(editorStatus, /unifiedStatusOptions\(selected\)/);
  assert.match(editorStatus, /<span id="editor-status-label">Status<\/span>/);
  assert.doesNotMatch(editorStatus, /saleReviewEditor\(w\)|type="checkbox"/);
  const detail = source('function renderDetail()', 'function showCancellationRefresh()');
  assert.match(detail, /saleDetailView\(s,\{esc,money,date,time,can,icon,statusBadge,operationalStatusControl\}\)/);
  assert.doesNotMatch(detail, /saleReviewControl|sale-state-summary|Status operacional/);
  const table = source('function saleTable(', 'function statusCatalogPanel(');
  assert.match(table, /<th>Status<\/th><th>Avisos<\/th>/);
  assert.doesNotMatch(table, /Status operacional|Situação da venda|operationalBadge\(s\.operational_status\)|reviewBadge\(s\)/);
});

test('lista de vendas: cartão inteiro abre o pedido e resume venda, custo e lucro em uma linha', () => {
  const record = {
    id: 's', number: 8, status: 'confirmed', customer_name: 'Cliente teste', business_date: '2026-09-13', registered_at: '2026-09-13T17:35:00.000Z',
    items: [{ description: 'Produto que só aparece no detalhe' }], total_cents: 10000, known_cost_cents: 6000, freight_cents: 300,
    expenses: [{ amount_cents: 100 }], profit_cents: 3400, pending_cost_quantity: 0,
    reconciliation: { state: 'matched', gross_cents: 10000, pending_cents: 0, excess_cents: 0, fee_cents: 200 }, review: { required: false }
  };
  const html = salesRecords([record], {
    esc, money: String, date: () => '13/09/2026', time: () => '14:35', can: () => true, statusBadge: () => '<span>Confirmada</span>', paymentBadge: () => '<span>Pago</span>',
    operationalStatusControl: () => '<span>Status operacional</span>', reviewControl: () => '<span>A conferir</span>', empty: () => ''
  });
  assert.doesNotMatch(html, /Confirmada|Pago|Provisório/);
  assert.match(html, /sales-records-compact[\s\S]*sale-record sale-record-compact/);
  assert.match(html, /class="sale-record-overview"><button type="button" class="sale-record-open-button" data-action="open-sale" data-id="s"/);
  assert.match(html, /Cliente teste[\s\S]*sale-timing[\s\S]*13\/09\/2026[\s\S]*14:35/);
  assert.match(html, /sale-record-compact-values values-3[\s\S]*<small>Venda<\/small><strong>10000<\/strong>[\s\S]*<small>Custo total<\/small><strong>6600<\/strong>[\s\S]*<small>Lucro<\/small><strong>3400<\/strong>/);
  assert.match(html, /sale-record-compact-footer[\s\S]*sale-record-compact-status[\s\S]*Status operacional/);
  assert.doesNotMatch(html, /Produto que só aparece no detalhe|<table|data-action="edit-sale"|data-action="cancel-sale"/);
  assert.equal((html.match(/data-action="open-sale"/g) ?? []).length, 1);
  assert.match(css, /\.sale-record-compact\s*\{[^}]*border-left:4px solid #087d98[^}]*box-shadow/);
  assert.match(css, /\.sale-record-compact-values\s*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media screen and \(max-width:700px\)[\s\S]*\.sale-record-compact-values\s*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.sale-record-compact-footer \.badge,\.sale-record-compact-footer \.wholesale-badge\s*\{[^}]*min-height:24px/);
});
