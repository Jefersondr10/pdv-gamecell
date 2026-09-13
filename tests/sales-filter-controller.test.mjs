import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesFilterController } from '../public/sales-filter-controller.mjs';

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const deferred = () => {
 let resolve, reject;
 const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
 return { promise, resolve, reject };
};

function form(values, { disabled = [] } = {}) {
 const fields = Object.entries(values).map(([name, value]) => ({
  name, value, disabled: disabled.includes(name),
  dataset: ['from', 'to'].includes(name) ? { dateKind: 'date' } : {}
 }));
 return { isConnected: true, fields, querySelectorAll: () => fields.filter(field => field.dataset.dateKind) };
}

function harness(options = {}) {
 const timers = new Map(), calls = [], errors = [], success = [], busyChanges = [];
 let busy = !!options.busy, serial = 0;
 const controller = createSalesFilterController({
  apply: async data => { calls.push(data); return options.apply?.(data); },
  isBusy: () => busy,
  setBusy: value => { busy = value; busyChanges.push(value); options.setBusy?.(value); },
  today: () => '2026-09-13',
  onError: error => errors.push(error.message),
  onSuccess: (node, data) => success.push({ form: node, data }),
  isCurrent: options.isCurrent,
  snapshot: node => Object.fromEntries(node.fields.filter(field => !field.disabled).map(field => [field.name, field.value])),
  schedule: (callback, delay) => { assert.equal(delay, 40); timers.set(++serial, callback); return serial; },
  cancel: id => timers.delete(id)
 });
 return {
  controller, calls, errors, success, busyChanges, timers,
  setExternalBusy: value => { busy = value; },
  get busy() { return busy; },
  async tick() {
   const callbacks = [...timers.values()]; timers.clear();
   callbacks.forEach(callback => callback());
   await settle();
  }
 };
}

test('filtros automáticos: captura valores e normaliza datas antes de bloquear os controles', async () => {
 const node = form({ date_preset: 'period', from: '01/09/2026', to: '13/09/2026', seller_id: 'v1', status: 'confirmed', q: 'Câmera', sale_type: 'wholesale' });
 const response = deferred();
 const x = harness({ apply: () => response.promise, setBusy: value => { if (value) node.fields.forEach(field => { field.disabled = true; }); } });
 assert.equal(x.controller.request(node, { automatic: true }), true);
 assert.deepEqual(x.calls, [{ date_preset: 'period', from: '2026-09-01', to: '2026-09-13', seller_id: 'v1', status: 'confirmed', q: 'Câmera', sale_type: 'wholesale' }]);
 assert.equal(x.busy, true);
 assert.equal(node.fields.find(field => field.name === 'from').value, '01/09/2026');
 response.resolve(); await settle();
 assert.equal(x.busy, false); assert.equal(x.success[0].form, node); assert.deepEqual(x.errors, []);
});

test('filtros automáticos: datas ocultas e desabilitadas não bloqueiam os atalhos', async () => {
 const x = harness(), node = form({ date_preset: 'month', from: 'incompleta', to: '', seller_id: 'v2' }, { disabled: ['from', 'to'] });
 assert.equal(x.controller.request(node, { automatic: true }), true);
 await settle(); assert.deepEqual(x.calls, [{ date_preset: 'month', seller_id: 'v2' }]); assert.deepEqual(x.errors, []);
});

test('filtros automáticos: período incompleto, impossível ou invertido espera a correção sem consulta', async () => {
 const x = harness();
 for (const [from, to] of [['', ''], ['1', '13/09/2026'], ['31/02/2026', '13/09/2026'], ['14/09/2026', '13/09/2026']]) {
  assert.equal(x.controller.request(form({ date_preset: 'period', from, to }), { automatic: true }), false);
 }
 assert.deepEqual(x.calls, []); assert.deepEqual(x.errors, []); assert.deepEqual(x.busyChanges, []);
 assert.equal(x.controller.request(form({ date_preset: 'period', from: '14/09/2026', to: '13/09/2026' })), false);
 assert.match(x.errors[0], /posterior/);
 assert.equal(x.controller.request(form({ date_preset: 'period', from: '01/09/2026', to: '13/09/2026' }), { automatic: true }), true);
 await settle(); assert.equal(x.calls.length, 1);
});

test('filtros automáticos: aguarda operação global e aplica somente a última seleção mesmo após renderização', async () => {
 const x = harness({ busy: true }), node = form({ date_preset: 'month', seller_id: 'v1' });
 assert.equal(x.controller.request(node), true); assert.equal(x.timers.size, 1);
 await x.tick(); assert.equal(x.timers.size, 1); assert.deepEqual(x.calls, []);
 node.fields.find(field => field.name === 'seller_id').value = 'v2';
 x.controller.request(node, { automatic: true }); assert.equal(x.timers.size, 1);
 node.isConnected = false;
 node.fields.find(field => field.name === 'seller_id').value = 'desatualizado';
 x.setExternalBusy(false); await x.tick();
 assert.deepEqual(x.calls, [{ date_preset: 'month', seller_id: 'v2' }]); assert.equal(x.timers.size, 0);
 assert.deepEqual(x.busyChanges, [true, false]);
});

test('filtros automáticos: uma consulta ativa mantém somente a próxima intenção sem concorrência', async () => {
 const first = deferred(), x = harness({ apply: () => x.calls.length === 1 ? first.promise : undefined });
 x.controller.request(form({ date_preset: 'today' }));
 x.controller.request(form({ date_preset: 'yesterday' }));
 x.controller.request(form({ date_preset: 'month', status: 'draft' }));
 assert.equal(x.calls.length, 1); assert.equal(x.timers.size, 0);
 first.resolve(); await settle(); assert.equal(x.timers.size, 1);
 await x.tick();
 assert.deepEqual(x.calls, [{ date_preset: 'today' }, { date_preset: 'month', status: 'draft' }]);
 assert.deepEqual(x.busyChanges, [true, false, true, false]);
});

test('filtros automáticos: editar intervalo incompleto substitui consulta ainda aguardando', async () => {
 const x = harness({ busy: true });
 x.controller.request(form({ date_preset: 'month' }));
 assert.equal(x.controller.request(form({ date_preset: 'period', from: '01/', to: '' }), { automatic: true }), false);
 x.setExternalBusy(false); await x.tick();
 assert.deepEqual(x.calls, []); assert.equal(x.timers.size, 0); assert.deepEqual(x.errors, []);
});

test('filtros automáticos: navegação e limpar fila impedem consultas antigas após sair da tela', async () => {
 let current = true;
 const x = harness({ busy: true, isCurrent: () => current });
 x.controller.request(form({ date_preset: 'month' }));
 current = false; x.setExternalBusy(false); await x.tick(); assert.deepEqual(x.calls, []); assert.equal(x.timers.size, 0);
 current = true; x.setExternalBusy(true); x.controller.request(form({ date_preset: 'today' }));
 x.controller.clear(); x.setExternalBusy(false); await x.tick(); assert.deepEqual(x.calls, []); assert.equal(x.timers.size, 0);
 const removed = form({ date_preset: 'today' }); removed.isConnected = false;
 assert.equal(x.controller.request(removed), false); assert.deepEqual(x.errors, []);
});

test('filtros automáticos: falha informa o erro, libera operação e permite uma nova consulta', async () => {
 const first = deferred(), x = harness({ apply: () => x.calls.length === 1 ? first.promise : undefined });
 x.controller.request(form({ date_preset: 'month' }));
 first.reject(Error('Falha de conexão')); await settle();
 assert.deepEqual(x.errors, ['Falha de conexão']); assert.equal(x.busy, false); assert.deepEqual(x.success, []);
 x.controller.request(form({ date_preset: 'today' })); await settle(); assert.equal(x.calls.length, 2); assert.equal(x.success.length, 1);
});

test('filtros automáticos: limpar durante consulta descarta fila e retorno visual da sessão anterior', async () => {
 const response = deferred(), x = harness({ apply: () => response.promise });
 x.controller.request(form({ date_preset: 'today' }));
 x.controller.request(form({ date_preset: 'month' }));
 x.controller.clear(); response.resolve(); await settle(); await x.tick();
 assert.equal(x.calls.length, 1); assert.deepEqual(x.success, []); assert.equal(x.busy, false); assert.equal(x.timers.size, 0);
});
