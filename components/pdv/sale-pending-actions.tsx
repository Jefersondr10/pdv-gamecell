'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CircleAlert, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { requestJson, messageOf } from '@/lib/client-api';
import type { SaleRecord } from '@/lib/pdv-types';
import type { ReceiptConflicts } from '@/lib/sale-activity';
import {
  salePendingItems,
  type SalePendingAction,
} from '@/lib/sale-pending-actions';

export function SalePendingActions({
  sale,
  allowed,
  disabled,
  onAction,
  onOpenSale,
}: {
  sale: SaleRecord;
  allowed: Record<SalePendingAction, boolean>;
  disabled: boolean;
  onAction: (action: SalePendingAction) => void;
  onOpenSale: (id: string) => Promise<unknown>;
}) {
  const items = salePendingItems(sale);
  const [conflicts, setConflicts] = useState<ReceiptConflicts | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function checkDuplicates() {
    if (request.current || disabled) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await requestJson<ReceiptConflicts>(
        `/api/sales/${encodeURIComponent(sale.id)}/receipt-conflicts`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setConflicts(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(messageOf(cause));
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function openRelated(id: string) {
    if (opening || disabled) return;
    setOpening(true);
    setError('');
    try {
      const result = await onOpenSale(id);
      if (typeof result === 'string') setError(result);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setOpening(false);
    }
  }
  if (!items.length) return null;
  return (
    <section
      className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-800 dark:bg-amber-950/30"
      aria-label="Pendências da venda"
    >
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-extrabold text-amber-950 dark:text-amber-200">
        <CircleAlert className="size-4" /> O que falta resolver{' '}
        <span className="ml-auto text-xs">
          {items.length} {items.length === 1 ? 'pendência' : 'pendências'}
        </span>
      </h3>
      <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">
        Os avisos desaparecem quando os dados são corrigidos; abrir uma ação não
        altera pagamentos.
      </p>
      <ol className="mt-3 grid gap-3 sm:grid-cols-2">
        {items.map((item, index) => (
          <li
            key={item.key}
            className="min-w-0 rounded-lg border border-amber-200 bg-card p-3 dark:border-amber-800"
          >
            <h4 className="flex items-start gap-2 text-sm font-extrabold">
              <span className="flex size-5 shrink-0 items-center justify-center rounded bg-amber-100 text-xs text-amber-950">
                {index + 1}
              </span>
              {item.title}
            </h4>
            <ul className="mt-2 space-y-1">
              {item.reasons.map((reason) => (
                <li
                  key={reason}
                  className="text-xs leading-relaxed text-muted-foreground"
                >
                  {reason}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              {item.actions
                .filter((action) => allowed[action.key])
                .map((action) => (
                  <Button
                    key={action.key}
                    size="sm"
                    variant="outline"
                    disabled={disabled || opening}
                    onClick={() => onAction(action.key)}
                  >
                    {action.label}
                  </Button>
                ))}
            </div>
            {!item.actions.some((action) => allowed[action.key]) && (
              <p className="mt-2 text-xs font-semibold text-muted-foreground">
                Peça a um responsável com permissão para corrigir.
              </p>
            )}
            {item.key === 'review' && (
              <Button
                className="mt-2"
                size="sm"
                variant="ghost"
                disabled={busy || disabled || opening}
                onClick={() => void checkDuplicates()}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                Localizar transação repetida
              </Button>
            )}
          </li>
        ))}
      </ol>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-destructive/5 p-3 text-sm font-semibold text-destructive"
        >
          {error}
        </p>
      )}
      {conflicts && (
        <div className="mt-3 space-y-2 rounded-lg border bg-card p-3">
          <h4 className="text-sm font-bold">
            Conferência de transações repetidas
          </h4>
          {!conflicts.items.length && (
            <p className="text-xs text-muted-foreground">
              Nenhuma outra venda ativa foi localizada pelo identificador
              disponível. Confira o documento; isso não libera o pagamento
              automaticamente.
            </p>
          )}
          {conflicts.items.map((item) => (
            <div
              key={`${item.receiptId}:${item.otherReceiptId}`}
              className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs"
            >
              <span>
                Comprovante{' '}
                {sale.receipts.findIndex(
                  (receipt) => receipt.id === item.receiptId,
                ) + 1}
                :{' '}
                {item.saleId === sale.id
                  ? 'transação repetida nesta própria venda.'
                  : `também aparece na venda #${String(item.saleNumber).padStart(5, '0')} · ${item.customerName}.`}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || opening}
                onClick={() =>
                  item.saleId === sale.id
                    ? onAction('view_receipts')
                    : void openRelated(item.saleId)
                }
              >
                <ArrowUpRight className="size-3.5" />
                {item.saleId === sale.id ? 'Ver comprovantes' : 'Ver venda'}
              </Button>
            </div>
          ))}
          {conflicts.hasMore && (
            <p className="text-xs text-muted-foreground">
              Há mais ocorrências. Confira os documentos antes de alterar a
              venda.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
