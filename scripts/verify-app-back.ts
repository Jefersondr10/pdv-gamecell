import assert from 'node:assert/strict';
import {
  createBackHandlers,
  entryBackStep,
  installBackGuard,
  saleBackStep,
  replaceGuardedUrl,
} from '../lib/app-back.ts';

const handlers = createBackHandlers();
const called: string[] = [];
handlers.register(() => {
  called.push('view');
  return true;
});
const removeWizard = handlers.register(() => {
  called.push('wizard');
  return true;
}, 10);
const removeDialog = handlers.register(() => {
  called.push('dialog');
  return true;
}, 100);
const removeChild = handlers.register(() => {
  called.push('nested');
  return true;
}, 101);
handlers.dispatch();
removeChild();
handlers.dispatch();
removeDialog();
handlers.dispatch();
removeWizard();
handlers.dispatch();
assert.deepEqual(called, ['nested', 'dialog', 'wizard', 'view']);
const pass = createBackHandlers();
pass.register(() => false, 10);
assert.equal(pass.dispatch(), false);
// Busy/required dialogs consume Back even when their close callback refuses it.
pass.register(() => true, 100);
assert.equal(pass.dispatch(), true);

assert.deepEqual(
  ['review', 'photos', 'serials', 'product-confirm'].map(entryBackStep),
  ['photos', 'serials', 'product-confirm', 'product-scan'],
);
assert.equal(entryBackStep('done'), null);
assert.equal(entryBackStep('product-scan'), null);
assert.deepEqual(
  ['review', 'receipt', 'payments', 'items', 'price', 'photo', 'serial'].map(
    (step) => saleBackStep(step, false),
  ),
  ['receipt', 'payments', 'items', 'customer', 'photo', 'serial', 'customer'],
);
assert.equal(saleBackStep('serial', true), 'items');
assert.equal(saleBackStep('done', true), null);

let index = 1;
const entries: unknown[] = [{ outside: true }, { router: 'keep-me' }];
const listeners = new Set<() => void>();
const href = 'https://test/?store=test';
const host = {
  location: { href },
  history: {
    get state() {
      return entries[index];
    },
    replaceState(state: unknown, _unused: string, url: string) {
      assert.equal(url, href);
      entries[index] = state;
    },
    pushState(state: unknown, _unused: string, url: string) {
      assert.equal(url, href);
      entries.splice(index + 1);
      entries.push(state);
      index++;
    },
    go(delta: number) {
      if (index + delta < 0 || index + delta >= entries.length) return;
      index += delta;
      [...listeners].forEach((listener) => listener());
    },
  },
  addEventListener(_name: string, listener: () => void) {
    listeners.add(listener);
  },
  removeEventListener(_name: string, listener: () => void) {
    listeners.delete(listener);
  },
};
let backs = 0;
let guard = installBackGuard(host as unknown as Window, () => {
  backs++;
});
assert.equal(entries.length, 3);
assert.equal((host.history.state as { router: string }).router, 'keep-me');
for (let i = 0; i < 50; i++) host.history.go(-1);
assert.equal(backs, 50);
assert.equal(entries.length, 3);
guard.dispose();
guard = installBackGuard(host as unknown as Window, () => {
  backs++;
});
assert.equal(entries.length, 3, 'reload/Strict Mode must reuse sentinel');
assert.equal(listeners.size, 1);
guard.leave();
assert.equal(listeners.size, 0);
assert.deepEqual(host.history.state, { outside: true });
assert.equal(backs, 50, 'explicit exit does not intercept or log out');
// Fresh PWA: go(-2) has no destination, so it must release to the native root.
entries.splice(0, entries.length, { fresh: true });
index = 0;
guard = installBackGuard(host as unknown as Window, () => {
  backs++;
});
await new Promise<void>((resolve) => guard.leave(resolve));
assert.equal(index, 0);
assert.equal(listeners.size, 0);
assert.equal(backs, 50);
console.log(
  'Back passed: bounded history, remount, explicit exit, layer priority and wizard steps.',
);

// Closing a report must not resurrect its original query on Back/reload.
let linkIndex = 0;
const urls = [
  {
    url: 'https://test/?report=sales',
    state: { router: 'preserved' } as Record<string, unknown>,
  },
];
const linkListeners = new Set<() => void>();
const linkHost = {
  location: {
    get href() {
      return urls[linkIndex].url;
    },
  },
  history: {
    get state() {
      return urls[linkIndex].state;
    },
    replaceState(state: Record<string, unknown>, _title: string, url: string) {
      urls[linkIndex] = { url, state };
    },
    pushState(state: Record<string, unknown>, _title: string, url: string) {
      urls.splice(linkIndex + 1);
      urls.push({ url, state });
      linkIndex++;
    },
    go(delta: number) {
      linkIndex += delta;
      linkListeners.forEach((handle) => handle());
    },
  },
  addEventListener(_name: string, handle: () => void) {
    linkListeners.add(handle);
  },
  removeEventListener(_name: string, handle: () => void) {
    linkListeners.delete(handle);
  },
};
const linkedGuard = installBackGuard(linkHost as unknown as Window, () => {});
replaceGuardedUrl(linkHost as unknown as Window, '/');
linkHost.history.go(-1);
assert.equal(linkHost.location.href, 'https://test/');
assert.equal(linkHost.history.state.router, 'preserved');
assert.equal(urls.length, 2);
assert.throws(() =>
  replaceGuardedUrl(linkHost as unknown as Window, 'https://outside.test/'),
);
linkedGuard.dispose();
