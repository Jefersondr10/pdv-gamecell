// One bounded browser-history guard. Internal views keep their own lightweight
// stack; no customer, receipt, or authentication data is written to history.
const marker = '__pdvBackV1';
export function createBackHandlers() {
  const handlers: { priority: number; handle: () => boolean }[] = [];
  return {
    register(handle: () => boolean, priority = 0) {
      const entry = { handle, priority };
      handlers.push(entry);
      return () => {
        const index = handlers.indexOf(entry);
        if (index >= 0) handlers.splice(index, 1);
      };
    },
    dispatch() {
      const ordered = [...handlers]
        .reverse()
        .sort((a, b) => b.priority - a.priority);
      return ordered.some((entry) => entry.handle());
    },
  };
}

type HistoryHost = Pick<
  Window,
  'history' | 'location' | 'addEventListener' | 'removeEventListener'
>;
export function installBackGuard(host: HistoryHost, onBack: () => void) {
  const mark = (value: 'anchor' | 'guard') => ({
    ...host.history.state,
    [marker]: value,
  });
  const arm = () =>
    host.history.pushState(mark('guard'), '', host.location.href);
  // Reuse the sentinel across Strict Mode remounts and reloads.
  if (host.history.state?.[marker] !== 'guard') {
    host.history.replaceState(mark('anchor'), '', host.location.href);
    arm();
  }
  const listener = () => {
    if (host.history.state?.[marker] !== 'anchor') return;
    arm(); // Replaces the forward sentinel rather than growing the stack.
    onBack();
  };
  host.addEventListener('popstate', listener);
  const dispose = () => host.removeEventListener('popstate', listener);
  let leaving = false;
  return {
    dispose,
    leave(onBoundary: () => void = () => {}) {
      if (leaving) return;
      leaving = true;
      dispose();
      // Explicit exit only. Keep the login session; never call logout on Back.
      // A fresh PWA may have no document before our anchor. Browsers ignore an
      // out-of-range go(), so release to the anchor and let native Back close it.
      let moved = false;
      const left = () => {
        moved = true;
        host.removeEventListener('popstate', left);
      };
      host.addEventListener('popstate', left);
      host.history.go(-2);
      setTimeout(() => {
        host.removeEventListener('popstate', left);
        if (!moved) {
          host.history.go(-1);
          onBoundary();
        }
      }, 500);
    },
  };
}

export function entryBackStep(step: string) {
  const steps = {
    'product-confirm': 'product-scan',
    serials: 'product-confirm',
    photos: 'serials',
    review: 'photos',
  } as const;
  return steps[step as keyof typeof steps] ?? null;
}
export function saleBackStep(step: string, hasItems: boolean) {
  if (step === 'serial') return hasItems ? 'items' : 'customer';
  const steps = {
    photo: 'serial',
    price: 'photo',
    items: 'customer',
    payments: 'items',
    receipt: 'payments',
    review: 'receipt',
  } as const;
  return steps[step as keyof typeof steps] ?? null;
}
