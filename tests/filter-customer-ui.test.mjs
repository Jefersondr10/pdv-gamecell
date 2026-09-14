import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dateInput, dateRange, salesFilterValues } from '../public/date-control.mjs';

const app = readFileSync(new URL('../public/app.mjs', import.meta.url), 'utf8');
function source(from, to) {
  const start = app.indexOf(from), end = app.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `Trecho ausente: ${from}`);
  return app.slice(start, end);
}
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const plain = value => JSON.parse(JSON.stringify(value));
const helpers = {
  esc, dateRange, salesFilterValues, saoPauloToday: () => '2026-09-13',
  todayFilter: () => ({ from: '2026-09-13', to: '2026-09-13' }),
  filterDateLabel: value => value.split('-').reverse().join('/'),
  field: (label, content) => `<label class="field">${label}${content}</label>`,
  input: (name, value = '', extra = '') => /type="date"/.test(extra) ? dateInput(name, value, extra) : `<input name="${name}" value="${esc(value)}" ${extra}>`,
  option: (value, label, selected) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`,
  cpfLabel: value => String(value ?? '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
};

test('interface de filtro: todos os dias, tipo e busca preservam seleção e escapam conteúdo', () => {
  const ctx = { ...helpers, filter: { date_preset: 'all', sale_type: 'wholesale', q: '"><script>consulta</script>' },
    state: { user: { id: 'owner' }, users: [{ id: 'seller', name: '<Vendedor>' }], sales: [{ id: 'sale' }] },
    saleStatuses: () => [{ id: 'status', name: '<Status>' }] };
  runInNewContext(source('const reviewStatusValue=', 'function reviewBadge(') + source('function dateFilterSummary(', 'function cents(') + source('function filters(', 'function empty('), ctx);
  let html = ctx.filters();
  assert.match(html, /value="all" selected>Todos os dias/); assert.match(html, /value="wholesale" selected>Atacado/);
  assert.match(html, /data-filter-owner="owner"/); assert.match(html, /name="q"[^>]*maxlength="120"/);
  assert.match(html, /Período aplicado: Todos os dias/); assert.match(html, /1 registro encontrado/);
  assert.match(html, /&lt;Vendedor&gt;/); assert.match(html, /&lt;Status&gt;/); assert.match(html, /&quot;&gt;&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|<Vendedor>|<Status>/);
  ctx.filter = helpers.todayFilter(); html = ctx.filters(); assert.match(html, /value="today" selected>Hoje/); assert.match(html, /Atacado e varejo/);
  ctx.filter = { ...helpers.todayFilter(), sale_type: 'retail' }; assert.match(ctx.filters(), /value="retail" selected>Varejo/);
});

test('interface de vendas: cartões de totais ficam somente no dashboard', () => {
  const dashboard = source('function renderDashboard()', 'function renderSales()');
  const sales = source('function renderSales()', 'const productNameButton');
  assert.match(dashboard, /class="metric-grid"/);
  assert.doesNotMatch(sales, /metric-grid|Lucro apurado|Recebido bruto|A receber/);
  assert.match(sales, /salesRecords\(state\.sales/);
});

test('interface de filtro: recarga conserva todos os dias e restaura hoje somente para filtros sem período', async () => {
  const calls = [], ctx = { ...helpers, URLSearchParams, filter: { date_preset: 'all', sale_type: 'retail', q: 'João' },
    view: 'sales', detailId: null, salesRefreshPending: true, api: async path => { calls.push(path); return { user: { id: 'owner' } }; }, financeUI: { load: async () => {} } };
  ctx.adoptState=next=>{ctx.state=next;};
  runInNewContext(source('async function load()', 'const navs='), ctx);
  await ctx.load(); const query = new URLSearchParams(calls[0].split('?')[1]);
  assert.equal(query.get('date_preset'), 'all'); assert.equal(query.has('from'), false); assert.equal(query.has('to'), false);
  assert.equal(query.get('sale_type'), 'retail'); assert.equal(query.get('q'), 'João'); assert.equal(ctx.salesRefreshPending, false);
  ctx.filter = {}; await ctx.load(); const todayQuery = new URLSearchParams(calls[1].split('?')[1]);
  assert.equal(todayQuery.get('from'), '2026-09-13'); assert.equal(todayQuery.get('to'), '2026-09-13');
});

function customerContext({ failure = false, allowed = true, detailCancelled = false } = {}) {
  const calls = [], current = { id: 'customer', name: '<Nome atualizado>', cpf: '52998224725', phone: '11999990000', email: 'novo@example.test', edit_token: 'fresh-token' };
  const confirmed = { id: 'confirmed', customer_id: current.id, customer_name: 'Nome anterior', status: 'confirmed', edit_token: 'sale-token' };
  const cancelled = { id: 'cancelled', customer_id: current.id, customer_name: 'Nome fotografado', status: 'cancelled' };
  const working = { customer_id: 'different-customer', items: [{ description: 'Preenchimento' }], payments: [], step: 'people' };
  const ctx = { ...helpers, current, state: { customers: [{ ...current, name: 'Nome anterior', edit_token: 'stale-token' }], sales: [confirmed, cancelled] },
    working, workingDirty: false, salesRefreshPending: false, view: 'customers', detailSale: { ...(detailCancelled ? cancelled : confirmed) },
    can: () => allowed, api: async (path, data, method) => { calls.push({ path, data, method }); if (failure) throw Error('Falha de teste'); return current; },
    modal: { close: () => calls.push('close') }, render: () => calls.push('render'), toast: text => calls.push(text),
    showModal: (...args) => calls.push({ modal: args }), load: () => { throw Error('O cadastro já salvo não depende do financeiro.'); } };
  runInNewContext(source('async function saveCustomerForm(', 'function renderEditor(') + source('function customerFormFields(', 'function openModal('), ctx);
  return { ctx, calls, current, confirmed, cancelled, working };
}

test('interface do cliente: edição busca dados e token atuais, escapa formulário e respeita permissão', async () => {
  const x = customerContext(); await x.ctx.openCustomerEditor(x.current.id);
  assert.deepEqual(x.calls[0], { path: '/customers/customer', data: undefined, method: undefined });
  const [title, html, id, attrs] = x.calls[1].modal;
  assert.equal(title, 'Editar cliente'); assert.equal(id, 'customer-form'); assert.equal(attrs, 'data-id="customer"');
  assert.match(html, /name="edit_token" value="fresh-token"/); assert.doesNotMatch(html, /stale-token|<Nome atualizado>/);
  assert.match(html, /&lt;Nome atualizado&gt;/); assert.match(html, /529\.982\.247-25/); assert.match(html, /maxlength="40"/); assert.match(html, /type="email" maxlength="254"/);
  const denied = customerContext({ allowed: false }); await denied.ctx.openCustomerEditor('customer'); assert.deepEqual(denied.calls, []);
  const failure = customerContext({ failure: true }); await assert.rejects(failure.ctx.openCustomerEditor('customer'), /Falha/); assert.equal(failure.calls.length, 1);
});

test('interface do cliente: PUT mantém vínculo e rascunho, atualiza nomes ativos e invalida consulta sem mudar canceladas', async () => {
  for (const detailCancelled of [false, true]) {
    const x = customerContext({ detailCancelled }), data = { name: x.current.name, edit_token: 'fresh-token' };
    await x.ctx.saveCustomerForm(data, { dataset: { id: x.current.id } });
    assert.deepEqual(x.calls[0], { path: '/customers/customer', data, method: 'PUT' });
    assert.equal(x.ctx.state.customers.length, 1); assert.equal(x.ctx.state.customers[0], x.current); assert.equal(x.ctx.working, x.working);
    assert.equal(x.working.customer_id, 'different-customer'); assert.equal(x.ctx.workingDirty, false);
    assert.equal(x.confirmed.customer_name, x.current.name); assert.equal(x.confirmed.edit_token, 'sale-token');
    assert.equal(x.cancelled.customer_name, 'Nome fotografado'); assert.equal(x.ctx.detailSale.customer_name, detailCancelled ? 'Nome fotografado' : x.current.name);
    assert.equal(x.ctx.salesRefreshPending, true); assert.deepEqual(x.calls.slice(1, 3), ['close', 'render']);
  }
});

test('interface do cliente: falha de PUT conserva formulário, token, nomes e estado da consulta', async () => {
  const x = customerContext({ failure: true }), before = plain(x.ctx.state), form = { dataset: { id: 'customer' }, payload: { name: 'Nome digitado', edit_token: 'fresh-token' } };
  const submit = { disabled: false }, error = { textContent: '', isConnected:true }; form.id = 'customer-form'; form.matches=()=>false; form.querySelector = selector => selector === '[type="submit"]' ? submit : selector === '.error' ? error : null;
  x.ctx.document = { addEventListener(type, callback) { assert.equal(type, 'submit'); x.ctx.submitHandler = callback; } };
  x.ctx.FormData = class { constructor(target) { return Object.entries(target.payload); } };
  x.ctx.normalizeDateFields = () => {}; x.ctx.busy = false;
  runInNewContext(source("document.addEventListener('submit',async e=>{", "window.addEventListener('beforeunload'"), x.ctx);
  await x.ctx.submitHandler({ target: form, preventDefault() {} });
  assert.equal(error.textContent, 'Falha de teste'); assert.equal(submit.disabled, false); assert.equal(x.ctx.busy, false);
  assert.equal(form.payload.name, 'Nome digitado'); assert.equal(form.payload.edit_token, 'fresh-token');
  assert.deepEqual(plain(x.ctx.state), before); assert.equal(x.ctx.salesRefreshPending, false); assert.equal(x.calls.length, 1);
});

async function navigate({ destination = 'sales', failure = false, pending = true } = {}) {
  const calls = [], oldState = { sales: [{ id: 'old-match' }] }, fresh = { sales: [], dashboard: { revenue_cents: 0 } };
  const ctx = { rememberWorking:()=>{},button: { dataset: { view: destination } }, view: 'customers', working: null, workingDirty: false, salesRefreshPending: pending,
    state: oldState, filter: { date_preset: 'all', q: 'Nome anterior', sale_type: 'wholesale' }, URLSearchParams, busy: false,
    salesFilters: { clear: () => calls.push('clear') }, api: async path => { calls.push(path); if (failure) throw Error('Falha de atualização'); return fresh; },
    render: () => calls.push('render'), toast: message => calls.push(message) };
  ctx.adoptState=next=>{ctx.state=next;};
  await runInNewContext(`(async()=>{${source(' if(button.dataset.view){', ' const a=button.dataset.action')}})()`, ctx);
  return { ctx, calls, oldState, fresh };
}

test('interface de navegação: após editar cliente, atualiza busca antes de mostrar vendas ou dashboard', async () => {
  for (const destination of ['sales', 'dashboard']) {
    const x = await navigate({ destination }); const query = new URLSearchParams(x.calls[0].split('?')[1]);
    assert.equal(query.get('q'), 'Nome anterior'); assert.equal(query.get('sale_type'), 'wholesale'); assert.equal(query.get('date_preset'), 'all');
    assert.equal(x.ctx.state, x.fresh); assert.equal(x.ctx.salesRefreshPending, false); assert.equal(x.ctx.view, destination);
    assert.deepEqual(x.calls.slice(1), ['clear', 'render']); assert.equal(x.ctx.busy, false);
  }
  const other = await navigate({ destination: 'products' }); assert.equal(other.ctx.salesRefreshPending, true); assert.deepEqual(other.calls, ['clear', 'render']);
  const noChange = await navigate({ pending: false }); assert.equal(noChange.ctx.state, noChange.oldState); assert.deepEqual(noChange.calls, ['clear', 'render']);
});

test('interface de navegação: falha de atualização mantém cadastro visível e exige nova tentativa', async () => {
  const x = await navigate({ failure: true }); assert.equal(x.ctx.view, 'customers'); assert.equal(x.ctx.state, x.oldState);
  assert.equal(x.ctx.salesRefreshPending, true); assert.equal(x.ctx.busy, false); assert.equal(x.calls.at(-1), 'Falha de atualização');
  assert.ok(!x.calls.includes('render')); assert.ok(!x.calls.includes('clear'));
});

test('interface de filtro: Limpar invalida intenção pendente e formulário de outra sessão não é aplicado', async () => {
  const calls = [], clear = source("else if(a==='clear-filters')", 'else if').replace('else if', 'if');
  await runInNewContext(`(async()=>{${clear}})()`, { a: 'clear-filters', salesFilters: { clear: () => calls.push('clear') }, applySalesFilters: async data => calls.push(plain(data)) });
  assert.deepEqual(calls, ['clear', { date_preset: 'today' }]);
  let options; const ctx = { createSalesFilterController: value => { options = value; return {}; }, applySalesFilters() {}, busy: false,
    saoPauloToday: helpers.saoPauloToday, state: { user: { id: 'owner' } }, view: 'sales', salesRefreshPending: true,
    salesMutationRefreshPending: false, cancellationRefreshPending: false };
  runInNewContext(source('const salesFilters=createSalesFilterController(', 'const stockUI='), ctx);
  assert.equal(options.isCurrent({ dataset: { filterOwner: 'owner' } }), true);
  assert.equal(options.isCurrent({ dataset: { filterOwner: 'other-owner' } }), false);
  ctx.salesMutationRefreshPending = true; assert.equal(options.isCurrent({ dataset: { filterOwner: 'owner' } }), false); ctx.salesMutationRefreshPending = false;
  ctx.cancellationRefreshPending = true; assert.equal(options.isCurrent({ dataset: { filterOwner: 'owner' } }), false); ctx.cancellationRefreshPending = false;
  ctx.view = 'customers'; assert.equal(options.isCurrent({ dataset: { filterOwner: 'owner' } }), false);
  ctx.view = 'ranking'; assert.equal(options.isCurrent({ dataset: { filterOwner: 'owner' } }), true);
  ctx.view = 'sales'; ctx.state = null; assert.equal(options.isCurrent({ dataset: { filterOwner: 'owner' } }), false);
});

async function changeSale(kind, { failWrite = false, failRefresh = false, expired = false } = {}) {
  const calls = [], el = kind === 'wholesale'
    ? { dataset: { saleWholesale: 'sale', previous: 'true' }, checked: false, disabled: false, isConnected: true }
    : { dataset: { saleStatus: 'sale', previous: 'old-status' }, value: 'new-status', disabled: false, isConnected: true };
  const oldState = { sales: [{ id: 'sale', edit_token: 'current-sale-token', is_wholesale: true }], dashboard: { revenue_cents: 1000 } };
  const fresh = { sales: [], dashboard: { revenue_cents: 0 } };
  const ctx = { el, busy: false, view: 'sales', state: oldState, detailId: null, detailSale: null, reviewStatusValue: '__review__', salesMutationRefreshPending: false,
    crypto: { randomUUID: () => 'test-request' }, salesFilters: { clear: () => calls.push('clear') },
    api: async (path, data, method) => { calls.push({ path, data: plain(data), method }); if (failWrite) throw Error('Falha ao salvar'); },
    load: async () => {
      calls.push('load');
      if (expired) { ctx.state = null; ctx.salesMutationRefreshPending = false; throw Object.assign(Error('Sessão expirada'), { status: 401 }); }
      if (failRefresh) throw Error('Falha ao consultar'); ctx.state = fresh;
    },
    render: () => calls.push({ renderPending: ctx.salesMutationRefreshPending }), toast: text => calls.push(text) };
  const change = kind === 'wholesale'
    ? source(' if(el.dataset.saleWholesale!==undefined){', ' if(el.dataset.saleStatus!==undefined){')
    : source(' if(el.dataset.saleStatus!==undefined){', " if(view!=='editor')return;");
  await runInNewContext(`(async()=>{${change}})()`, ctx);
  return { ctx, calls, oldState, fresh, el };
}

test('interface de venda: atacado/status salvos com falha na consulta bloqueiam totais antigos e não repetem gravação', async () => {
  for (const kind of ['wholesale', 'status']) {
    const x = await changeSale(kind, { failRefresh: true });
    assert.equal(x.calls[0].path, `/sales/sale/${kind}`); assert.equal(x.calls[0].method, 'PUT');
    if (kind === 'wholesale') { assert.equal(x.calls[0].data.is_wholesale, false); assert.equal(x.calls[0].data.edit_token, 'current-sale-token'); }
    else assert.equal(x.calls[0].data.operational_status_id, 'new-status');
    assert.equal(x.ctx.salesMutationRefreshPending, true); assert.equal(x.ctx.state, x.oldState); assert.equal(x.ctx.busy, false); assert.equal(x.el.disabled, false);
    assert.deepEqual(x.calls.slice(1, 4), ['load', 'clear', { renderPending: true }]); assert.match(x.calls.at(-1), /salv[oa].*Atualize/);
    const success = await changeSale(kind); assert.equal(success.ctx.state, success.fresh); assert.equal(success.ctx.salesMutationRefreshPending, false);
  }
  let html = '', continued = false;
  runInNewContext(`(()=>{${source(' if(salesMutationRefreshPending){', " if(view==='dashboard')")}continued=true;})()`, {
    salesMutationRefreshPending: true, heading: (title, subtitle) => `${title}${subtitle}`, page: content => { html = content; }, set continued(value) { continued = value; }
  });
  assert.match(html, /Alteração salva/); assert.match(html, /data-action="refresh-sales"/); assert.match(html, /não é necessário salvar novamente/); assert.equal(continued, false);
});

test('interface de venda: falha na gravação restaura controle e mantém consulta disponível', async () => {
  for (const kind of ['wholesale', 'status']) {
    const x = await changeSale(kind, { failWrite: true });
    assert.equal(x.ctx.salesMutationRefreshPending, false); assert.equal(x.ctx.state, x.oldState); assert.equal(x.ctx.busy, false); assert.equal(x.el.disabled, false);
    assert.equal(x.calls.length, 2); assert.equal(x.calls.at(-1), 'Falha ao salvar');
    if (kind === 'wholesale') assert.equal(x.el.checked, true); else assert.equal(x.el.value, 'old-status');
  }
});

test('interface de venda: sessão expirada após salvar atacado/status não recria pendência no próximo login', async () => {
  for (const kind of ['wholesale', 'status']) {
    const x = await changeSale(kind, { expired: true });
    assert.equal(x.calls[0].method, 'PUT'); assert.equal(x.calls[0].path, `/sales/sale/${kind}`);
    assert.deepEqual(x.calls.slice(1), ['load', 'Sessão expirada']);
    assert.equal(x.ctx.state, null); assert.equal(x.ctx.salesMutationRefreshPending, false);
    assert.equal(x.ctx.busy, false); assert.equal(x.el.disabled, false);
    x.ctx.state = { user: { id: 'other-user' }, sales: [], dashboard: { revenue_cents: 0 } };
    assert.equal(x.ctx.salesMutationRefreshPending, false);
  }
});

test('interface de venda: atualização pendente impede navegação e botão Atualizar executa apenas nova consulta', async () => {
  for (const failure of [false, true]) {
    const calls = [], button = { dataset: { view: 'dashboard' }, disabled: false }, ctx = {
      busy: false, mutationRefreshPending:'', cancellationRefreshPending: false, salesMutationRefreshPending: true, view: 'sales',
      load: async () => { calls.push('load'); if (failure) throw Error('Consulta ainda indisponível'); },
      render: () => calls.push('render'), toast: text => calls.push(text),
      document: { addEventListener(type, callback) { assert.equal(type, 'click'); ctx.clickHandler = callback; }, querySelector: () => null }
    };
    runInNewContext(source("document.addEventListener('click',async e=>{", "document.addEventListener('submit',async e=>{"), ctx);
    const event = { target: { closest: selector => selector === '[data-action],[data-view]' ? button : null } }; await ctx.clickHandler(event);
    assert.equal(ctx.view, 'sales'); assert.equal(ctx.salesMutationRefreshPending, true); assert.equal(calls.length, 1); assert.match(calls[0], /já foi salva/);
    calls.length = 0; button.dataset = { action: 'refresh-sales' }; await ctx.clickHandler(event);
    assert.equal(calls[0], 'load'); assert.equal(ctx.busy, false); assert.equal(button.disabled, false);
    assert.equal(ctx.salesMutationRefreshPending, failure);
    assert.deepEqual(calls, failure ? ['load', 'Consulta ainda indisponível'] : ['load', 'render']);
  }
});
