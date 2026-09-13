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

const ReceiptRuntime = createContext({ enabled: false, csrfToken: '' });
export const useReceiptRuntime = () => useContext(ReceiptRuntime);
export type ServerReceiptJob = {
  id: string;
  amountCents: number | null;
  source: 'ocr' | 'manual' | null;
  status: string | null;
  updatedAt: number | null;
  confirmedAt: number | null;
  generation: number | null;
};

export function ServerReceiptProvider({
  enabled,
  csrfToken,
  children,
}: {
  enabled: boolean;
  csrfToken: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let running = false;
    let timer: ReturnType<typeof setTimeout>;
    let previous = '';
    const poll = async () => {
      if (running) return;
      running = true;
      let delay = 60_000;
      try {
        if (!document.hidden && navigator.onLine !== false) {
          const result = await requestJson<{
            version: string;
            pending: number;
          }>('/api/receipt-ocr/status');
          if (!alive) return;
          if (previous && previous !== result.version)
            window.dispatchEvent(new Event('pdv:sales-changed'));
          previous = result.version;
          if (result.pending) delay = 15_000;
        }
      } catch {
        /* Work continues on the server without blocking sales. */
      } finally {
        running = false;
        if (alive) timer = setTimeout(poll, delay);
      }
    };
    const resume = () => {
      clearTimeout(timer);
      void poll();
    };
    void poll();
    window.addEventListener('online', resume);
    window.addEventListener('pdv:receipts-saved', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener('online', resume);
      window.removeEventListener('pdv:receipts-saved', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [enabled]);
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
  const [jobs, setJobs] = useState<Record<string, ServerReceiptJob>>({});
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const callback = useRef(onValues);
  useEffect(() => {
    callback.current = onValues;
  }, [onValues]);
  useEffect(() => {
    if (!enabled || !saleId) return;
    const refresh = () => setRevision((current) => current + 1);
    window.addEventListener('pdv:receipts-saved', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener('pdv:receipts-saved', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [enabled, saleId]);
  useEffect(() => {
    if (!enabled || !saleId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let previous = '';
    const poll = async () => {
      let delay = 30_000;
      try {
        if (!document.hidden && navigator.onLine !== false) {
          const result = await requestJson<{ receipts: ServerReceiptJob[] }>(
            `/api/sales/${saleId}/receipt-ocr`,
          );
          if (!alive) return;
          setError('');
          setJobs(
            Object.fromEntries(result.receipts.map((row) => [row.id, row])),
          );
          callback.current(result.receipts);
          const signature = JSON.stringify(result.receipts);
          if (previous && previous !== signature)
            window.dispatchEvent(new Event('pdv:sales-changed'));
          previous = signature;
          if (
            result.receipts.some(
              (row) =>
                row.amountCents === null &&
                (!row.status ||
                  ['pending', 'processing', 'retry'].includes(row.status)),
            )
          )
            delay = 5000;
        }
      } catch {
        if (alive)
          setError(
            'Sem atualização da leitura. O processamento continua no servidor.',
          );
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
      setRevision((current) => current + 1);
      window.dispatchEvent(new Event('pdv:receipts-saved'));
      window.dispatchEvent(new Event('pdv:sales-changed'));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Não foi possível solicitar outra leitura. Tente novamente.',
      );
    }
  };
  return { enabled, jobs, error, retry };
}
