'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { requestJson } from '@/lib/client-api';
import type { SalePaymentRecord } from '@/lib/pdv-types';
const formatMoney = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type State = {
  status: string;
  requestId: string | null;
  updatedAt: number | null;
  saleStatus: string;
  complete: boolean;
  receivedTotalCents: number;
  productsTotalCents: number;
  receiptTotalCents: number;
  payments: SalePaymentRecord[];
  expectedPayments: string;
  expectedReceipts: string;
};

export function ReceiptPaymentSync({
  saleId,
  productsTotalCents,
  csrfToken,
  canUse,
  disabled,
  onPayments,
}: {
  saleId: string;
  productsTotalCents: number;
  csrfToken: string;
  canUse: boolean;
  disabled: boolean;
  onPayments: (
    payments: SalePaymentRecord[],
    receivedTotalCents: number,
  ) => boolean;
}) {
  const [state, setState] = useState<State>();
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const callback = useRef(onPayments);
  const operation = useRef<{ signature: string; id: string } | null>(null);
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
  }, [saleId, revision]);
  if (!state || state.saleStatus !== 'completed') return null;
  const targetId =
    target || (state.payments.length === 1 ? state.payments[0].id : '');
  const difference = state.receiptTotalCents - state.receivedTotalCents;
  const differenceFromSale = state.receiptTotalCents - productsTotalCents;
  return (
    <div className="mt-3 rounded-xl border bg-muted/30 p-3 text-sm">
      <p className="font-semibold">
        {state.status === 'applied'
          ? 'Total pago atualizado pelos comprovantes'
          : state.status === 'pending'
            ? 'Atualização do pagamento pendente'
            : 'Total pago e comprovantes'}
      </p>
      <p className="mt-1 text-muted-foreground">
        {state.status === 'pending'
          ? 'O total pago será atualizado quando todos os comprovantes tiverem valor. Se algum arquivo não for reconhecido, corrija sua leitura.'
          : state.status === 'applied'
            ? 'Uma nova alteração manual no pagamento prevalece até outro envio ou correção de comprovante.'
            : state.requestId === null && state.complete && difference !== 0
              ? `Os comprovantes ainda não foram usados para atualizar este pagamento. ${canUse ? 'Use o botão abaixo para aplicar a soma já salva.' : 'Um usuário com permissão de pagamentos pode aplicar a soma já salva.'}`
              : 'Ao reenviar ou corrigir comprovantes, a soma poderá atualizar o total pago. Uma edição manual posterior será preservada.'}
      </p>
      {state.complete && (
        <p className="mt-2">
          Comprovantes: <strong>{formatMoney(state.receiptTotalCents)}</strong>{' '}
          · Pago informado:{' '}
          <strong>{formatMoney(state.receivedTotalCents)}</strong>
        </p>
      )}
      {canUse &&
        state.complete &&
        difference !== 0 &&
        state.status !== 'pending' && (
          <div className="mt-3 space-y-2">
            <p className="text-sm">
              Ao usar os comprovantes, o pagamento informado passará para{' '}
              <strong>{formatMoney(state.receiptTotalCents)}</strong>
              {productsTotalCents > 0 && differenceFromSale !== 0
                ? ` e ficará ${formatMoney(Math.abs(differenceFromSale))} ${differenceFromSale < 0 ? 'abaixo' : 'acima'} da venda.`
                : '.'}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {state.payments.length > 1 && (
                <NativeSelect
                  aria-label="Pagamento a ajustar pelos comprovantes"
                  value={target}
                  disabled={disabled || busy}
                  onChange={(event) => setTarget(event.target.value)}
                  className="min-w-0 flex-1"
                >
                  <NativeSelectOption value="">
                    Escolha qual pagamento ajustar
                  </NativeSelectOption>
                  {state.payments.map((p, index) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {index + 1}.{' '}
                      {p.method === 'pix'
                        ? `Pix · ${p.accountName ?? 'Conta cadastrada'}`
                        : 'Dinheiro'}{' '}
                      · {formatMoney(p.amountCents)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled || busy || !targetId}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  const payload = {
                    targetPaymentId: targetId,
                    expectedPayments: state.expectedPayments,
                    expectedReceipts: state.expectedReceipts,
                    expectedRequestId: state.requestId,
                  };
                  const signature = JSON.stringify(payload);
                  if (operation.current?.signature !== signature)
                    operation.current = { signature, id: crypto.randomUUID() };
                  try {
                    const next = await requestJson<State>(
                      `/api/sales/${saleId}/receipt-payment`,
                      {
                        method: 'POST',
                        headers: {
                          'content-type': 'application/json',
                          'x-csrf-token': csrfToken,
                        },
                        body: JSON.stringify({
                          ...payload,
                          operationId: operation.current.id,
                        }),
                      },
                    );
                    setState(next);
                    callback.current(next.payments, next.receivedTotalCents);
                    window.dispatchEvent(new Event('pdv:sales-changed'));
                    setRevision((value) => value + 1);
                  } catch (caught) {
                    setError(
                      caught instanceof Error
                        ? caught.message
                        : 'Não foi possível atualizar. Confira a venda.',
                    );
                    setRevision((value) => value + 1);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Atualizando…' : 'Usar total dos comprovantes'}
              </Button>
            </div>
          </div>
        )}
      {state.status === 'review' && (
        <p className="mt-2 text-amber-800">
          Confira os pagamentos. A diferença não foi distribuída automaticamente
          entre contas ou formas de pagamento.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Ao substituir um arquivo, exclua o anterior para não somar o mesmo
        comprovante duas vezes. Esta conferência não verifica crédito no banco.
      </p>
    </div>
  );
}
