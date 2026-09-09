import { processReceiptPaymentSync } from '../receipt-payment-sync.ts';

export function startReceiptPaymentJobs(db) {
  let stopped = false;
  let timer;
  async function run() {
    try {
      await processReceiptPaymentSync(db);
    } catch {
      console.error(
        'Receipt payment synchronization deferred; intent retained.',
      );
    }
    if (!stopped) {
      timer = setTimeout(run, 5000);
      timer.unref?.();
    }
  }
  timer = setTimeout(run, 1000);
  timer.unref?.();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
