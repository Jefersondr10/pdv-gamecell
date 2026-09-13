import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { jsx, jsxs } from 'react/jsx-runtime';
import { installBackGuard } from '../lib/app-back.ts';
import { changedProductPrices } from '../lib/product-prices.ts';

// Execute the actual component callbacks with deterministic browser boundaries.
// No network, real session, database, or React rendering is needed for these events.
function component(file, name) {
  const source = ts.createSourceFile(
    file,
    readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  return source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
}
function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, (child) => find(child, predicate));
}
function call(node, name) {
  return find(
    node,
    (candidate) =>
      ts.isCallExpression(candidate) && candidate.expression.getText() === name,
  );
}
function evaluate(source, globals) {
  const output = ts.transpileModule(`const subject = ${source};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  return runInNewContext(`${output}\nsubject;`, {
    exports: {},
    require: () => ({ jsx, jsxs }),
    ...globals,
  });
}
function surface() {
  const listeners = new Map();
  const events = [];
  return {
    events,
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener);
    },
    dispatchEvent(event) {
      events.push(event.type);
      for (const listener of listeners.get(event.type) ?? []) listener(event);
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Pointer focus selects the whole number even if the browser moves the caret
// during mouseup/click. Subsequent clicks, arrows, and raw decimal typing survive.
const priceNode = component(
  'components/pdv/views/stock-production-view.tsx',
  'StockPriceInput',
);
const PriceInput = evaluate(priceNode.getText().replace(/^export\s+/, ''), {
  useRef: (current) => ({ current }),
  Input: 'input',
});
let changed = '';
const props = PriceInput({
  value: '4.500,00',
  onChange: (event) => {
    changed = event.target.value;
  },
}).props;
const ownerDocument = { activeElement: null };
const input = {
  ownerDocument,
  value: '4.500,00',
  selectionStart: 4,
  selectionEnd: 4,
  select() {
    this.selectionStart = 0;
    this.selectionEnd = this.value.length;
  },
};
const event = { currentTarget: input };
props.onPointerDown(event);
ownerDocument.activeElement = input;
props.onFocus(event);
input.selectionStart = input.selectionEnd = 6;
props.onPointerUp(event);
input.selectionStart = input.selectionEnd = 6;
props.onClick(event);
assert.equal(input.selectionStart, 0);
assert.equal(input.selectionEnd, input.value.length);
input.value =
  input.value.slice(0, input.selectionStart) +
  '4500' +
  input.value.slice(input.selectionEnd);
props.onChange({ target: input });
assert.equal(changed, '4500');
assert.equal(
  changedProductPrices({ phone: 400000 }, { phone: changed })[0]
    .defaultPriceCents,
  450000,
);
props.onPointerDown(event);
input.selectionStart = input.selectionEnd = 2;
props.onPointerUp(event);
props.onClick(event);
assert.equal(
  input.selectionStart,
  2,
  'a later click must preserve intentional caret placement',
);
props.onBlur();
ownerDocument.activeElement = null;
input.value = '4.500,00';
// Touch can focus after pointerup; focus and click must still finish selected.
props.onPointerDown(event);
props.onPointerUp(event);
ownerDocument.activeElement = input;
props.onFocus(event);
props.onClick(event);
assert.equal(input.selectionEnd, 8);
props.onBlur();
input.value = '4500,50';
props.onFocus(event); // Keyboard Tab, no pointer event.
assert.equal(input.selectionStart, 0);
assert.equal(input.selectionEnd, 7);
assert.equal(
  changedProductPrices({ phone: 1 }, { phone: '4500,50' })[0].defaultPriceCents,
  450050,
);
assert.equal(
  changedProductPrices({ phone: 1 }, { phone: '4500.50' })[0].defaultPriceCents,
  450050,
);
assert.equal(
  changedProductPrices({ phone: 1 }, { phone: '0' })[0].defaultPriceCents,
  0,
);
assert.throws(() => changedProductPrices({ phone: 1 }, { phone: '' }));

// Use the actual authenticated root callback together with the real history guard.
const cloud = component('components/pdv/production-app.tsx', 'CloudPdv');
const guardCall = call(cloud, 'useAppBackGuard');
assert.equal(
  guardCall.arguments.length,
  1,
  'bootstrap/errors must not disable the authenticated guard',
);
const app = {
  data: { user: {} },
  activeView: 'sales',
  linkedReport: true,
  navigation: [{ view: 'sell' }, { view: 'stock' }],
  canView: (_user, view) => view === 'stock',
  previousViews: { current: [] },
  window: { location: { pathname: '/' } },
  setSaleToOpen() {},
  setRun() {},
  setActiveView(value) {
    app.activeView = value;
  },
  setLinkedReport(value) {
    app.linkedReport = value;
  },
  replaceGuardedUrl() {},
};
const rootCallback = evaluate(guardCall.arguments[0].getText(), app);
// Globals are copied into the VM; update the visible values through setters there.
rootCallback();
assert.equal(app.activeView, 'stock', 'root chooses an allowed home');
assert.equal(app.linkedReport, null);
const rootDuringBootstrap = evaluate(guardCall.arguments[0].getText(), {
  ...app,
  data: null,
});
rootDuringBootstrap();
let index = 1;
const entries = [{ page: 'old-login' }, { page: 'authenticated' }];
const historySurface = surface();
const host = {
  ...historySurface,
  location: { href: 'https://example.invalid/' },
  history: {
    get state() {
      return entries[index];
    },
    replaceState(state) {
      entries[index] = state;
    },
    pushState(state) {
      entries.splice(index + 1);
      entries.push(state);
      index++;
    },
    go(delta) {
      if (index + delta < 0 || index + delta >= entries.length) return;
      index += delta;
      historySurface.dispatchEvent({ type: 'popstate' });
    },
  },
};
const guard = installBackGuard(host, rootCallback);
for (let count = 0; count < 100; count++) host.history.go(-1);
assert.equal(index, 2, 'Back must never reach the preceding login document');
assert.equal(entries.length, 3, 'repeated Back must keep history bounded');
assert.equal(host.history.state.page, 'authenticated');
guard.dispose();

// BFCache pageshow rechecks an old login screen; transient failures keep an
// already authenticated app mounted. Stale requests cannot replace newer state.
const production = component(
  'components/pdv/production-app.tsx',
  'ProductionApp',
);
const sessionWindow = surface();
const sessionRef = { current: null };
const sessionRequestRef = { current: 0 };
let sessionState;
let sessionError = '';
let response = { authenticated: false };
let sessionGets = 0;
const sessionGlobals = {
  sessionRef,
  sessionRequestRef,
  setSession: (value) => {
    sessionState = value;
  },
  setSessionError: (value) => {
    sessionError = value;
  },
  messageOf: (error) => error.message,
  requestJson: async () => {
    sessionGets++;
    if (response instanceof Error) throw response;
    return response;
  },
};
const loadSession = evaluate(
  call(production, 'useCallback').arguments[0].getText(),
  sessionGlobals,
);
const sessionEffect = evaluate(
  call(production, 'useEffect').arguments[0].getText(),
  {
    loadSession,
    window: sessionWindow,
    queueMicrotask,
    sessionRequestRef,
  },
);
const disposeSession = sessionEffect();
await settle();
assert.equal(sessionState.authenticated, false);
response = { authenticated: true, user: { id: 'owner' } };
sessionWindow.dispatchEvent({ type: 'pageshow', persisted: true });
await settle();
assert.equal(sessionState.authenticated, true);
sessionWindow.dispatchEvent({ type: 'pageshow', persisted: false });
await settle();
assert.equal(sessionGets, 2);
response = new Error('temporary network failure');
sessionWindow.dispatchEvent({ type: 'pageshow', persisted: true });
await settle();
assert.equal(sessionState.authenticated, true);
assert.equal(sessionError, '');
disposeSession();

// Global activity is shared between tabs and only announces a real revision
// change. Failures retry sooner without forcing every screen to reload.
const provider = component(
  'components/pdv/server-receipt-runtime.tsx',
  'ServerReceiptProvider',
);
const runtimeWindow = surface();
const runtimeDocument = { ...surface(), hidden: false };
let clock = 0;
let timerId = 0;
const timers = new Map();
const schedule = (callback, delay) => {
  const id = ++timerId;
  timers.set(id, { callback, delay });
  return id;
};
let statusResponse = { version: 'same', pending: 0 };
const activityStorage = new Map();
const providerEffect = evaluate(
  call(provider, 'useEffect').arguments[0].getText(),
  {
    enabled: true,
    storeId: 'store-1',
    window: runtimeWindow,
    document: runtimeDocument,
    navigator: { onLine: true },
    localStorage: {
      getItem: (key) => activityStorage.get(key) ?? null,
      setItem: (key, value) => activityStorage.set(key, value),
    },
    RECEIPT_ACTIVITY_IDLE_POLL_MS: 120000,
    RECEIPT_ACTIVITY_PENDING_POLL_MS: 60000,
    RECEIPT_POLL_RETRY_MS: 60000,
    Event,
    Date: { now: () => clock },
    setTimeout: schedule,
    clearTimeout: (id) => timers.delete(id),
    requestJson: async () => {
      if (statusResponse instanceof Error) throw statusResponse;
      return statusResponse;
    },
  },
);
const disposeProvider = providerEffect();
await settle();
assert.equal(
  runtimeWindow.events.filter((name) => name === 'pdv:sales-changed').length,
  0,
);
async function tick() {
  const [id, timer] = timers.entries().next().value;
  timers.delete(id);
  clock += timer.delay;
  timer.callback();
  await settle();
  return timer.delay;
}
assert.equal(await tick(), 120000);
assert.equal(
  runtimeWindow.events.filter((name) => name === 'pdv:sales-changed').length,
  0,
  'an unchanged revision must not reload every screen',
);
statusResponse = new Error('status GET failed');
await tick();
statusResponse = { version: 'same', pending: 0 };
assert.equal(await tick(), 60000);
assert.equal(
  runtimeWindow.events.filter((name) => name === 'pdv:sales-changed').length,
  0,
);
statusResponse = { version: 'changed', pending: 0 };
assert.equal(await tick(), 120000);
assert.equal(
  runtimeWindow.events.filter((name) => name === 'pdv:sales-changed').length,
  1,
  'a new activity revision refreshes open consumers',
);
runtimeWindow.dispatchEvent({ type: 'focus' });
await settle();
assert.equal(await tick(), 1000);
assert.equal(
  runtimeWindow.events.filter((name) => name === 'pdv:sales-changed').length,
  1,
);
disposeProvider();
assert.equal(timers.size, 0);

const group = component(
  'components/pdv/group-details-dialog.tsx',
  'GroupDetailsDialog',
);
const groupWindow = { ...surface(), setTimeout: () => 1, clearTimeout() {} };
let groupLoads = 0;
const groupRequest = { current: 0 };
const groupEffect = evaluate(call(group, 'useEffect').arguments[0].getText(), {
  selection: { dimension: 'model' },
  window: groupWindow,
  requestIdRef: groupRequest,
  load: () => {
    groupLoads++;
  },
  setPage() {},
  setError() {},
  setLoading() {},
});
const disposeGroup = groupEffect();
groupWindow.dispatchEvent({ type: 'pdv:sales-changed' });
assert.equal(groupLoads, 1);
disposeGroup();
groupWindow.dispatchEvent({ type: 'pdv:sales-changed' });
assert.equal(groupLoads, 1);
assert.equal(groupRequest.current, 1);

console.log(
  'UI navigation passed: bounded authenticated Back, BFCache recovery, stock-price pointer/keyboard selection, refresh retries, and live group details.',
);
