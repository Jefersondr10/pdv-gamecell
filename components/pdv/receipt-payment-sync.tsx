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
  const hasPix = state.receiptTotalCents > 0;
  const hasCash = cashCents > 0;
  const received = state.receiptTotalCents + cashCents;
  const difference = received - productsTotalCents;
  return (
    <div className="mt-3 rounded-xl border bg-muted/30 p-3 text-sm">
      <p className="font-semibold">
        {hasPix
          ? 'Pix pelo comprovante · sem digitar valor ou banco'
          : hasCash
            ? 'Recebimento em dinheiro'
            : 'Pix será identificado pelo comprovante'}
      </p>
      <p className="mt-1 text-muted-foreground">
        {hasPix && hasCash
          ? 'O valor lido é somado ao dinheiro recebido e comparado com o preço da venda.'
          : hasPix
            ? 'O valor lido é comparado com o preço da venda.'
            : hasCash
              ? difference < 0
                ? 'O dinheiro recebido está registrado. Se o restante for Pix, anexe o comprovante.'
                : 'O dinheiro recebido é comparado com o preço da venda.'
              : 'Anexe o comprovante para identificar o Pix automaticamente.'}
      </p>
      <div className="mt-2 space-y-1">
        {received > 0 && (
          <p>
            {state.receiptTotalCents > 0 && (
              <>
                Recebido Pix:{' '}
                <strong>{formatMoney(state.receiptTotalCents)}</strong>
              </>
            )}
            {state.receiptTotalCents > 0 && cashCents > 0 && ' · '}
            {cashCents > 0 && (
              <>
                Recebido Dinheiro: <strong>{formatMoney(cashCents)}</strong>
              </>
            )}
          </p>
        )}
        <p>
          {received > 0 && (
            <>
              Total recebido: <strong>{formatMoney(received)}</strong> ·{' '}
            </>
          )}
          Venda: <strong>{formatMoney(productsTotalCents)}</strong>
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
              : hasPix && hasCash
                ? 'Comprovantes + dinheiro conferem com a venda.'
                : hasPix
                  ? 'Comprovantes conferem com a venda.'
                  : hasCash
                    ? 'Dinheiro recebido igual ao valor da venda.'
                    : 'Nenhum recebimento identificado.'}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {hasPix
          ? 'Pode concluir sem comprovante e anexar depois em Vendas. A conferência não confirma crédito no banco.'
          : hasCash
            ? difference === 0
              ? 'Venda coberta pelo dinheiro informado.'
              : 'O dinheiro recebido foi registrado. O valor restante continua pendente.'
            : 'Pode concluir sem comprovante e anexar depois em Vendas.'}
      </p>
    </div>
  );
}
