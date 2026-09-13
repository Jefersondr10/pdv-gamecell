'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  LoaderCircle,
  ShoppingBag,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  SaleDisplayStatusBadge,
  SaleIssuesNotice,
} from '@/components/pdv/sale-status-badge';
import { messageOf, requestJson } from '@/lib/client-api';
import type { ClientRecord, ClientHistoryPage } from '@/lib/pdv-types';

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (time: number) =>
  new Date(time).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });

export function ClientPurchaseHistory({
  client,
  onBack,
  onOpenSale,
}: {
  client: ClientRecord;
  onBack: () => void;
  onOpenSale?: (id: string) => void;
}) {
  const [page, setPage] = useState<ClientHistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const load = useCallback(
    async (cursor: string | null = null) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          period: 'all',
          group: 'sale',
          customerId: client.id,
          limit: '30',
        });
        if (cursor) params.set('cursor', cursor);
        const result = await requestJson<ClientHistoryPage>(
          `/api/sales?${params}`,
          {
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        setPage((current) =>
          cursor && current
            ? { ...result, items: [...current.items, ...result.items] }
            : result,
        );
      } catch (caught) {
        if (!controller.signal.aborted) setError(messageOf(caught));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [client.id],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const refresh = () => void load();
    window.addEventListener('pdv:sales-changed', refresh);
    return () => {
      window.clearTimeout(timer);
      requestRef.current?.abort();
      window.removeEventListener('pdv:sales-changed', refresh);
    };
  }, [load]);

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 overflow-hidden px-3 py-3 sm:px-6 lg:px-10 lg:py-5">
      <header className="flex shrink-0 items-start gap-2">
        <Button
          onClick={onBack}
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          aria-label="Voltar para clientes"
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Histórico de compras
          </p>
          <h1 className="break-words text-xl font-bold sm:text-2xl">
            {client.name}
          </h1>
          <p className="mt-0.5 break-words text-sm text-muted-foreground">
            {[client.phone, client.email].filter(Boolean).join(' · ') ||
              'Todo o histórico deste cliente'}
            {!client.active && ' · Cadastro excluído'}
          </p>
        </div>
      </header>
      {page && (
        <div className="shrink-0 rounded-xl border bg-card px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              <strong>{page.aggregates.saleCount}</strong> compras válidas ·{' '}
              <strong>{page.aggregates.itemCount}</strong> aparelhos
            </p>
            <p className="text-sm">
              Total comprado{' '}
              <strong className="ml-1 text-base">
                {money(page.aggregates.amountCents)}
              </strong>
            </p>
          </div>
          {page.total > page.aggregates.saleCount && (
            <p className="mt-1 text-xs text-muted-foreground">
              {page.total - page.aggregates.saleCount} cancelada(s), fora dos
              totais.
            </p>
          )}
        </div>
      )}
      <div
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1"
        aria-busy={loading}
      >
        {loading && !page && (
          <output className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin" /> Carregando compras…
          </output>
        )}
        {page?.items.map((sale) => (
          <article
            key={sale.id}
            className="rounded-2xl border bg-card p-3 sm:p-4"
          >
            <header className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  #{String(sale.number).padStart(5, '0')}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {date(sale.createdAt)}
                </span>
                <SaleDisplayStatusBadge
                  status={sale.displayStatus}
                  pixCents={sale.pixCents}
                  cashCents={sale.cashCents}
                />
              </div>
              <Button
                disabled={!onOpenSale}
                onClick={() => onOpenSale?.(sale.id)}
                size="sm"
                variant="outline"
                className="h-10"
                aria-label={`Abrir venda ${sale.number}`}
              >
                Ver venda <ArrowUpRight className="size-4" />
              </Button>
            </header>
            <SaleIssuesNotice issueKeys={sale.issueKeys} compact />
            <p className="mt-2 text-sm text-muted-foreground">
              Vendedor: {sale.sellerName}
            </p>
            <ul className="mt-2 divide-y">
              {sale.items.map((item) => (
                <li
                  className="grid gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3"
                  key={item.id}
                >
                  <div className="min-w-0">
                    <p className="break-words font-semibold">
                      {item.productName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.productDetail}
                    </p>
                    <p className="mt-0.5 break-all font-mono text-sm">
                      SN {item.serial}
                    </p>
                  </div>
                  <strong className="text-sm">
                    {money(item.soldPriceCents)}
                  </strong>
                </li>
              ))}
            </ul>
            <footer className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm">
              <span>
                Valor da compra{' '}
                <strong>{money(sale.productsTotalCents)}</strong>
              </span>
              <span className="text-muted-foreground">
                {sale.status === 'cancelled'
                  ? 'Pago antes do cancelamento'
                  : 'Total pago'}{' '}
                <strong className="text-foreground">
                  {money(sale.receivedTotalCents)}
                </strong>
              </span>
            </footer>
            {sale.status === 'cancelled' && (
              <p className="mt-2 text-xs text-muted-foreground">
                Cancelada em{' '}
                {sale.cancelledAt
                  ? date(sale.cancelledAt)
                  : 'data não informada'}
                {sale.cancellationReason ? ` · ${sale.cancellationReason}` : ''}
              </p>
            )}
          </article>
        ))}
        {!loading && !error && page?.total === 0 && (
          <div className="grid min-h-40 place-content-center gap-2 text-center text-muted-foreground">
            <ShoppingBag className="mx-auto size-8" />
            <p>Este cliente ainda não tem compras.</p>
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-xl border p-4 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              className="mt-2"
              variant="outline"
              disabled={loading}
              onClick={() => void load(page?.nextCursor ?? null)}
            >
              Tentar novamente
            </Button>
          </div>
        )}
        {page?.nextCursor && !error && (
          <div className="py-2 text-center">
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void load(page.nextCursor)}
            >
              {loading ? 'Carregando…' : 'Mostrar mais compras'}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
