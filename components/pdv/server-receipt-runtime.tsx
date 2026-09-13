'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { requestJson } from '@/lib/client-api';
import {
  receiptSalePollDelay,
  RECEIPT_ACTIVITY_IDLE_POLL_MS,
  RECEIPT_ACTIVITY_PENDING_POLL_MS,
  RECEIPT_POLL_RETRY_MS,
  RECEIPT_SALE_IDLE_POLL_MS,
  RECEIPT_SALE_BURST_WINDOW_MS,
  type ReceiptPaymentPollingState,
  type ReceiptSalePollingState,
  type ServerReceiptJob,
} from '@/lib/receipt-polling';

const ReceiptRuntime = createContext({ enabled: false, csrfToken: '' });
export const useReceiptRuntime = () => useContext(ReceiptRuntime);
export type { ServerReceiptJob } from '@/lib/receipt-polling';

type ReceiptActivity = {
  version: string;
  pending: number;
  checkedAt: number;
};
const EMPTY_RECEIPT_JOBS: Record<string, ServerReceiptJob> = {};

export function ServerReceiptProvider({
  enabled,
  csrfToken,
  storeId,
  children,
}: {
  enabled: boolean;
  csrfToken: string;
  storeId: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let running = false;
    let timer: ReturnType<typeof setTimeout>;
    let previous = '';
    const storageKey = `pdv:receipt-activity:${storeId}`;
    const intervalFor = (pending: number) =>
      pending
        ? RECEIPT_ACTIVITY_PENDING_POLL_MS
        : RECEIPT_ACTIVITY_IDLE_POLL_MS;
    const parseActivity = (value: string | null): ReceiptActivity | null => {
      try {
        const parsed = JSON.parse(value ?? '') as Partial<ReceiptActivity>;
        return typeof parsed.version === 'string' &&
          Number.isSafeInteger(parsed.pending) &&
          Number.isSafeInteger(parsed.checkedAt)
          ? (parsed as ReceiptActivity)
          : null;
      } catch {
        return null;
      }
    };
    const cachedActivity = () => {
      try {
        return parseActivity(localStorage.getItem(storageKey));
      } catch {
        return null;
      }
    };
    const announce = (activity: ReceiptActivity) => {
      if (previous && previous !== activity.version) {
        window.dispatchEvent(new Event('pdv:receipt-activity-changed'));
        window.dispatchEvent(new Event('pdv:sales-changed'));
      }
      previous = activity.version;
    };
    const schedule = (delay: number) => {
      clearTimeout(timer);
      if (alive) timer = setTimeout(() => void poll(), Math.max(1000, delay));
    };
    const poll = async (forceNetwork = false) => {
      if (running || !alive) return;
      if (document.hidden || navigator.onLine === false) {
        schedule(RECEIPT_ACTIVITY_IDLE_POLL_MS);
        return;
      }
      if (!forceNetwork) {
        const cached = cachedActivity();
        if (cached) {
          const remaining =
            intervalFor(cached.pending) - (Date.now() - cached.checkedAt);
          if (remaining > 0) {
            announce(cached);
            schedule(remaining);
            return;
          }
        }
      }
      running = true;
      try {
        const result = await requestJson<{
          version: string;
          pending: number;
        }>('/api/receipt-ocr/status');
        if (!alive) return;
        const activity = { ...result, checkedAt: Date.now() };
        announce(activity);
        try {
          localStorage.setItem(storageKey, JSON.stringify(activity));
        } catch {
          /* Polling still works when browser storage is unavailable. */
        }
        schedule(intervalFor(activity.pending));
      } catch {
        schedule(RECEIPT_POLL_RETRY_MS);
      } finally {
        running = false;
      }
    };
    const resume = () => {
      schedule(1000);
    };
    const saved = () => void poll(true);
    const storage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const activity = parseActivity(event.newValue);
      if (!activity) return;
      announce(activity);
      schedule(intervalFor(activity.pending));
    };
    void poll();
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pdv:receipts-saved', saved);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', resume);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pdv:receipts-saved', saved);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [enabled, storeId]);
  return (
    <ReceiptRuntime.Provider value={{ enabled, csrfToken }}>
      {children}
    </ReceiptRuntime.Provider>
  );
}

export function useServerReceiptJobs(
  saleId: string | undefined,
  onValues: (jobs: ServerReceiptJob[]) => void,
) {
  const { enabled, csrfToken } = useReceiptRuntime();
  const [snapshot, setSnapshot] = useState<{
    saleId: string;
    jobs: Record<string, ServerReceiptJob>;
    payment: ReceiptPaymentPollingState;
  }>();
  const visibleSnapshot =
    snapshot && snapshot.saleId === saleId ? snapshot : undefined;
  const jobs = visibleSnapshot?.jobs ?? EMPTY_RECEIPT_JOBS;
  const payment = visibleSnapshot?.payment;
  const [failure, setFailure] = useState<{
    saleId: string;
    message: string;
  }>();
  const visibleFailure =
    failure && failure.saleId === saleId ? failure : undefined;
  const error = visibleFailure?.message ?? '';
  const [revision, setRevision] = useState(0);
  const burstUntil = useRef(0);
  const callback = useRef(onValues);
  useEffect(() => {
    callback.current = onValues;
  }, [onValues]);
  useEffect(() => {
    if (!enabled || !saleId) return;
    burstUntil.current = 0;
    const refresh = () => setRevision((current) => current + 1);
    const refreshAfterReceiptAction = () => {
      burstUntil.current = Date.now() + RECEIPT_SALE_BURST_WINDOW_MS;
      refresh();
    };
    window.addEventListener('pdv:receipts-saved', refreshAfterReceiptAction);
    window.addEventListener('pdv:receipt-activity-changed', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener(
        'pdv:receipts-saved',
        refreshAfterReceiptAction,
      );
      window.removeEventListener('pdv:receipt-activity-changed', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [enabled, saleId]);
  useEffect(() => {
    if (!enabled || !saleId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let previous = '';
    const poll = async () => {
      let delay = RECEIPT_SALE_IDLE_POLL_MS;
      try {
        if (!document.hidden && navigator.onLine !== false) {
          const result = await requestJson<ReceiptSalePollingState>(
            `/api/sales/${saleId}/receipt-ocr`,
          );
          if (!alive) return;
          setFailure(undefined);
          setSnapshot({
            saleId,
            jobs: Object.fromEntries(
              result.receipts.map((row) => [row.id, row]),
            ),
            payment: result.payment,
          });
          callback.current(result.receipts);
          const signature = JSON.stringify(result);
          if (previous && previous !== signature)
            window.dispatchEvent(new Event('pdv:sales-changed'));
          previous = signature;
          delay = receiptSalePollDelay(result, burstUntil.current);
        }
      } catch {
        delay = RECEIPT_POLL_RETRY_MS;
        if (alive)
          setFailure({
            saleId,
            message:
              'Sem atualização da leitura. O processamento continua no servidor.',
          });
      }
      if (alive) timer = setTimeout(poll, delay);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [enabled, saleId, revision]);
  const retry = async (attachmentId: string) => {
    try {
      setFailure(undefined);
      const job = jobs[attachmentId];
      if (!job) throw new Error('Aguarde a atualização do comprovante.');
      await requestJson(`/api/sales/${saleId}/receipt-ocr`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          attachmentId,
          operationId: crypto.randomUUID(),
          expectedAmount: job.amountCents,
          expectedConfirmedAt: job.confirmedAt,
          expectedGeneration: job.generation,
        }),
      });
      window.dispatchEvent(new Event('pdv:receipts-saved'));
      window.dispatchEvent(new Event('pdv:sales-changed'));
    } catch (error) {
      setFailure({
        saleId: saleId ?? '',
        message:
          error instanceof Error
            ? error.message
            : 'Não foi possível solicitar outra leitura. Tente novamente.',
      });
    }
  };
  return { enabled, jobs, payment, error, retry };
}
