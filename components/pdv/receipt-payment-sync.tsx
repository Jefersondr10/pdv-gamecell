'use client';
import { useEffect, useRef } from 'react';
import type { SalePaymentRecord } from '@/lib/pdv-types';
import { paymentMethodTotals } from '@/lib/receipt-reconciliation';
import type { ReceiptPaymentPollingState } from '@/lib/receipt-polling';
const formatMoney = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export function ReceiptPaymentSync({
  state,
  productsTotalCents,
  disabled,
  onPayments,
}: {
  state: ReceiptPaymentPollingState | undefined;
  productsTotalCents: number;
  disabled: boolean;
  onPayments: (
    payments: SalePaymentRecord[],
    receivedTotalCents: number,
  ) => boolean;
}) {
  const callback = useRef(onPayments);
  useEffect(() => {
    callback.current = onPayments;
  }, [onPayments]);
  useEffect(() => {
    if (!disabled && state)
      callback.current(state.payments, state.receivedTotalCents);
  }, [disabled, state]);
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
