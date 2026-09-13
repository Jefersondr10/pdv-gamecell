'use client';
import { useEffect, useRef, useState } from 'react';
import { requestJson } from '@/lib/client-api';
import type { SalePaymentRecord } from '@/lib/pdv-types';
import { paymentMethodTotals } from '@/lib/receipt-reconciliation';
const formatMoney = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
type State = {
  status: string;
  requestId: string | null;
  saleStatus: string;
  complete: boolean;
  receivedTotalCents: number;
  receiptTotalCents: number;
  payments: SalePaymentRecord[];
  expectedPayments: string;
  expectedReceipts: string;
};
export function ReceiptPaymentSync({
  saleId,
  productsTotalCents,
  disabled,
  onPayments,
}: {
  saleId: string;
  productsTotalCents: number;
  disabled: boolean;
  onPayments: (
    payments: SalePaymentRecord[],
    receivedTotalCents: number,
  ) => boolean;
}) {
  const [state, setState] = useState<State>();
  const callback = useRef(onPayments);
  useEffect(() => {
    callback.current = onPayments;
  }, [onPayments]);
  useEffect(() => {
    if (!disabled && state)
      callback.current(state.payments, state.receivedTotalCents);
  }, [disabled, state]);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    let previous = '';
    const poll = async () => {
      if (running || !alive) return;
      running = true;
      let delay = 30000;
      try {
        if (!document.hidden && navigator.onLine !== false) {
          const next = await requestJson<State>(
            `/api/sales/${saleId}/receipt-payment`,
          );
          if (!alive) return;
          setState(next);
          const signature = JSON.stringify([
            next.expectedPayments,
            next.expectedReceipts,
            next.receivedTotalCents,
            next.status,
            next.requestId,
          ]);
          if (previous !== signature) {
            const accepted = callback.current(
              next.payments,
              next.receivedTotalCents,
            );
            if (previous) window.dispatchEvent(new Event('pdv:sales-changed'));
            if (accepted) previous = signature;
            else delay = 5000;
          }
          if (next.status === 'pending') delay = 5000;
        }
      } catch {
        /* Keep the last state; persisted server work continues. */
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
    window.addEventListener('pdv:receipts-saved', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener('pdv:receipts-saved', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [saleId]);

  if (!state || state.saleStatus !== 'completed') return null;
  const { cashCents } = paymentMethodTotals(state.payments);
  const received = state.receiptTotalCents + cashCents;
  const difference = received - productsTotalCents;
  return (
    <div className="mt-3 rounded-xl border bg-muted/30 p-3 text-sm">
      <p className="font-semibold">
        Pix pelo comprovante · sem digitar valor ou banco
      </p>
      <p className="mt-1 text-muted-foreground">
        Anexe o comprovante. O valor lido é somado ao dinheiro recebido e
        comparado com o preço da venda.
      </p>
      <div className="mt-2 space-y-1">
        <p>
          Comprovantes: <strong>{formatMoney(state.receiptTotalCents)}</strong>{' '}
          · Dinheiro: <strong>{formatMoney(cashCents)}</strong>
        </p>
        <p>
          Total recebido: <strong>{formatMoney(received)}</strong> · Venda:{' '}
          <strong>{formatMoney(productsTotalCents)}</strong>
        </p>
      </div>
      <p
        className={`mt-2 font-semibold ${difference === 0 && state.status !== 'review' ? 'text-success' : 'text-amber-800'}`}
      >
        {state.status === 'review'
          ? 'Confira o aviso no comprovante e use Reler comprovante para tentar novamente.'
          : difference < 0
            ? `Falta receber ${formatMoney(-difference)}`
            : difference > 0
              ? `Recebido acima da venda: ${formatMoney(difference)}`
              : 'Comprovantes + dinheiro conferem com a venda.'}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Pode concluir sem comprovante e anexar depois em Vendas. A conferência
        não confirma crédito no banco.
      </p>
    </div>
  );
}
