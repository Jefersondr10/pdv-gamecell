'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { requestJson } from '@/lib/client-api';
import type { PixAccountRecord, SalePaymentRecord } from '@/lib/pdv-types';
import { paymentMethodTotals } from '@/lib/receipt-reconciliation';
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
  pixAccounts,
  csrfToken,
  canUse,
  disabled,
  onPayments,
}: {
  saleId: string;
  productsTotalCents: number;
  pixAccounts: PixAccountRecord[];
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
  const [newPixAccountId, setNewPixAccountId] = useState('');
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
  const pixPayments = state.payments.filter((p) => p.method === 'pix');
  const firstPix = pixPayments.length === 0;
  const activeAccounts = pixAccounts.filter((account) => account.active);
  const newPixAccount = activeAccounts.find(
    (account) => account.id === newPixAccountId,
  );
  const { pixCents, cashCents } = paymentMethodTotals(state.payments);
  const targetId =
    pixPayments.find((p) => p.id === target)?.id ||
    (pixPayments.length === 1 ? pixPayments[0].id : '');
  const difference = state.receiptTotalCents - pixCents;
  const receivedAfter = state.receiptTotalCents + cashCents;
  const differenceFromSale = receivedAfter - productsTotalCents;
  return (
    <div className="mt-3 rounded-xl border bg-muted/30 p-3 text-sm">
      <p className="font-semibold">
        {firstPix && state.status === 'pending'
          ? 'Identificando o Pix pelos comprovantes'
          : firstPix && state.complete
            ? 'Comprovante lido · falta registrar o Pix'
            : state.status === 'applied'
              ? 'Pix atualizado pelos comprovantes'
              : state.status === 'pending'
                ? 'Atualização do Pix pendente'
                : 'Pix e comprovantes'}
      </p>
      <p className="mt-1 text-muted-foreground">
        {firstPix
          ? state.status === 'pending'
            ? 'A venda já está salva. Após a leitura, o sistema identificará a conta recebedora e registrará o Pix. Se não conseguir identificar com segurança, você poderá conferir abaixo.'
            : state.complete
              ? canUse
                ? 'Escolha a conta que recebeu o Pix e registre o pagamento abaixo. O valor já foi lido; dinheiro não será alterado.'
                : 'Um usuário com acesso a pagamentos e comprovantes precisa escolher a conta para registrar este Pix.'
              : 'Pode concluir sem comprovante. O recebido fica zerado ou apenas com o dinheiro informado, e o saldo fica pendente. Anexe ou releia um comprovante para identificar o Pix.'
          : state.status === 'pending'
            ? 'O Pix será atualizado quando todos os comprovantes tiverem valor. Dinheiro permanece como informado manualmente.'
            : state.status === 'applied'
              ? 'Uma nova alteração manual no pagamento prevalece até outro envio ou correção de comprovante.'
              : state.requestId === null && state.complete && difference !== 0
                ? `Os comprovantes ainda não foram usados para atualizar este pagamento. ${canUse ? 'Use o botão abaixo para aplicar a soma já salva.' : 'Um usuário com permissão de pagamentos pode aplicar a soma já salva.'}`
                : 'Ao reenviar ou corrigir comprovantes, a soma poderá atualizar apenas o Pix. Dinheiro e uma edição manual posterior são preservados.'}
      </p>
      {state.complete && (
        <p className="mt-2">
          Comprovantes: <strong>{formatMoney(state.receiptTotalCents)}</strong>{' '}
          · Pix informado: <strong>{formatMoney(pixCents)}</strong> · Dinheiro
          (manual): <strong>{formatMoney(cashCents)}</strong>
        </p>
      )}
      {canUse &&
        state.complete &&
        difference !== 0 &&
        state.status !== 'pending' && (
          <div className="mt-3 space-y-2">
            <p className="text-sm">
              {firstPix ? 'Será registrado um Pix de ' : 'O Pix passará para '}
              <strong>{formatMoney(state.receiptTotalCents)}</strong>, mantendo{' '}
              {formatMoney(cashCents)} em dinheiro. O total pago será{' '}
              <strong>{formatMoney(receivedAfter)}</strong>
              {productsTotalCents > 0 && differenceFromSale !== 0
                ? ` e ficará ${formatMoney(Math.abs(differenceFromSale))} ${differenceFromSale < 0 ? 'abaixo' : 'acima'} da venda.`
                : '.'}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {firstPix && (
                <NativeSelect
                  aria-label="Conta que recebeu o Pix do comprovante"
                  value={newPixAccountId}
                  disabled={disabled || busy}
                  onChange={(event) => setNewPixAccountId(event.target.value)}
                  className="min-w-0 flex-1"
                >
                  <NativeSelectOption value="">
                    Escolha a conta que recebeu
                  </NativeSelectOption>
                  {activeAccounts.map((account) => (
                    <NativeSelectOption key={account.id} value={account.id}>
                      {account.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
              {pixPayments.length > 1 && (
                <NativeSelect
                  aria-label="Pagamento a ajustar pelos comprovantes"
                  value={target}
                  disabled={disabled || busy}
                  onChange={(event) => setTarget(event.target.value)}
                  className="min-w-0 flex-1"
                >
                  <NativeSelectOption value="">
                    Escolha qual Pix ajustar
                  </NativeSelectOption>
                  {pixPayments.map((p, index) => (
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
                disabled={
                  disabled || busy || (firstPix ? !newPixAccount : !targetId)
                }
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  const payload = {
                    ...(firstPix
                      ? { pixAccountId: newPixAccount!.id }
                      : { targetPaymentId: targetId }),
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
                {busy
                  ? 'Registrando…'
                  : firstPix
                    ? 'Registrar Pix do comprovante'
                    : 'Usar total dos comprovantes'}
              </Button>
            </div>
            {firstPix && activeAccounts.length === 0 && (
              <p className="text-amber-800">
                Cadastre ou ative uma conta em Cadastros › Contas para registrar
                este Pix.
              </p>
            )}
            {disabled && (
              <p className="text-muted-foreground">
                Salve as alterações da venda antes de registrar o Pix.
              </p>
            )}
          </div>
        )}
      {!firstPix && state.status === 'review' && (
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
        Para tentar a leitura novamente, use Reler comprovante no arquivo já
        anexado. Não anexe o mesmo Pix duas vezes. Esta conferência compara
        documentos e valores; não confirma crédito no banco.
      </p>
    </div>
  );
}
