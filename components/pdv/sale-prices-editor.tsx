'use client';

import { useRef, useState } from 'react';
import { LoaderCircle, Pencil, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { messageOf, requestJson } from '@/lib/client-api';
import { createOperationId } from '@/lib/client-operation-id';
import { parseMoneyInput } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { SaleRecord } from '@/lib/pdv-types';
import type { SalePrices } from '@/lib/sale-prices';
import { deriveReceiptReconciliation } from '@/lib/receipt-reconciliation';

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const inputMoney = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export function SalePricesEditor({
  sale,
  csrfToken,
  disabled,
  onBusyChange,
  onEditingChange,
  onSaved,
}: {
  sale: SaleRecord;
  csrfToken: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onEditingChange: (editing: boolean) => void;
  onSaved: (value: SalePrices) => void;
}) {
  const [current, setCurrent] = useState<SalePrices | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const operationId = useRef(createOperationId());
  const items =
    current?.items.map((item) => ({
      id: item.id,
      expectedPriceCents: item.soldPriceCents,
      priceCents: parseMoneyInput(draft[item.id] ?? ''),
    })) ?? [];
  const changed = items.some(
    (item) => item.priceCents !== item.expectedPriceCents,
  );
  const invalid = items.some(
    (item) => item.priceCents <= 0 || item.priceCents > 1_000_000_000,
  );
  const newTotal = items.reduce((total, item) => total + item.priceCents, 0);
  const difference = sale.receivedTotalCents - newTotal;
  const receiptCheck = deriveReceiptReconciliation(sale.receipts, newTotal);
  const headers = {
    'content-type': 'application/json',
    'x-csrf-token': csrfToken,
  };
  async function start() {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      const value = await requestJson<SalePrices>(
        `/api/sales/${sale.id}/prices`,
      );
      if (value.status !== 'completed')
        throw new Error(
          'Esta venda foi cancelada. Não é possível alterar seus preços.',
        );
      setDraft(
        Object.fromEntries(
          value.items.map((item) => [item.id, inputMoney(item.soldPriceCents)]),
        ),
      );
      setCurrent(value);
      onEditingChange(true);
      operationId.current = createOperationId();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function save() {
    if (inFlight.current || disabled || !current || !changed || invalid) return;
    inFlight.current = true;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      const updated = await requestJson<SalePrices>(
        `/api/sales/${sale.id}/prices`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            operationId: operationId.current,
            revision: current.revision,
            items,
          }),
        },
      );
      setCurrent(null);
      onEditingChange(false);
      onSaved(updated);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section className="rounded-2xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-extrabold">Preços desta venda</h3>
          <p className="text-xs text-muted-foreground">
            Altere o valor de cada aparelho, sem mudar o cadastro ou os
            pagamentos.
          </p>
        </div>
        {!current && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || busy}
            onClick={() => void start()}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <Pencil />}{' '}
            Editar preços
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {current && (
        <div className="mt-3 space-y-3">
          {sale.items.map((item) => {
            const row = items.find((row) => row.id === item.id);
            if (!row) return null;
            const modified = row.priceCents !== row.expectedPriceCents;
            return (
              <label
                key={item.id}
                className={cn(
                  'block rounded-xl border p-3 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary',
                  modified && 'border-primary/40 bg-primary/5',
                )}
              >
                <span className="block text-sm font-bold">
                  {item.productName}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {item.productDetail} · SN {item.serial}
                </span>
                <span className="mt-2 block text-xs font-semibold">
                  Preço de venda
                </span>
                <Input
                  aria-label={`Preço de venda de ${item.productName}, SN ${item.serial}`}
                  className="mt-1 h-10 text-right font-bold"
                  inputMode="decimal"
                  disabled={disabled || busy}
                  value={draft[item.id] ?? ''}
                  onChange={(event) => {
                    operationId.current = createOperationId();
                    setDraft((values) => ({
                      ...values,
                      [item.id]: event.target.value,
                    }));
                  }}
                />
                {modified && (
                  <span className="mt-1 block text-xs font-semibold text-primary">
                    Antes: {money(row.expectedPriceCents)}
                  </span>
                )}
              </label>
            );
          })}
          <div className="rounded-xl bg-muted/40 p-3 text-sm">
            <p>Total anterior: {money(current.productsTotalCents)}</p>
            <p className="font-extrabold">Novo total: {money(newTotal)}</p>
            <p>Pagamentos registrados: {money(sale.receivedTotalCents)}</p>
            <p>
              Comprovantes com valor: {money(receiptCheck.confirmedTotalCents)}
            </p>
            {!invalid && (
              <p className="mt-1 text-xs text-muted-foreground">
                {receiptCheck.status === 'pending'
                  ? `${receiptCheck.pendingReceiptCount} comprovante(s) pendente(s) de valor ou anexo. A conferência ainda não terminou.`
                  : receiptCheck.differenceCents === 0
                    ? 'Comprovantes conferem com o novo total.'
                    : `Comprovantes ${receiptCheck.differenceCents! < 0 ? 'abaixo' : 'acima'} do novo total em ${money(Math.abs(receiptCheck.differenceCents!))}.`}
              </p>
            )}
            {!invalid && (
              <p
                className={cn(
                  'mt-1 font-semibold',
                  difference === 0 ? 'text-foreground' : 'text-amber-800',
                )}
              >
                {difference < 0
                  ? `Falta receber ${money(-difference)}`
                  : difference > 0
                    ? `Pago a mais: ${money(difference)}. Verifique a venda.`
                    : 'Pagamento informado igual ao novo valor da venda'}
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Este botão salva somente os preços, registra a alteração e recalcula
            a conferência dos comprovantes. Outras edições continuam neste
            formulário.
          </p>
          {invalid && (
            <p role="alert" className="text-xs text-destructive">
              Informe um preço maior que zero para cada aparelho.
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || busy}
              onClick={() => {
                setCurrent(null);
                onEditingChange(false);
                setError('');
              }}
            >
              Cancelar edição dos preços
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={disabled || busy || invalid || !changed}
              onClick={() => void save()}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <Check />}{' '}
              Salvar preços da venda
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
