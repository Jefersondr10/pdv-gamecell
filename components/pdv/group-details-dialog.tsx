'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { messageOf, requestJson } from '@/lib/client-api';
import type {
  SalesGrouping,
  SalesGroupRecord,
  SalesGroupDetailPage,
} from '@/lib/pdv-types';

export type SelectedGroup = {
  dimension: SalesGrouping | 'product';
  row: SalesGroupRecord & { color?: string | null; memory?: string | null };
};
const formatMoney = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDateTime = (time: number) =>
  new Date(time).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });

export function GroupDetailsDialog({
  selection,
  filterParams,
  onOpenChange,
  onOpenSale,
}: {
  selection: SelectedGroup | null;
  filterParams: string;
  onOpenChange: (open: boolean) => void;
  onOpenSale?: (id: string) => void;
}) {
  const [page, setPage] = useState<SalesGroupDetailPage>({
    items: [],
    nextCursor: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (cursor: string | null = null, append = false) => {
      if (!selection) return;
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams(filterParams);
        params.set('dimension', selection.dimension);
        params.set('key', selection.row.key);
        params.set('limit', '50');
        if (cursor) params.set('cursor', cursor);
        const next = await requestJson<SalesGroupDetailPage>(
          `/api/sales/groups?${params.toString()}`,
        );
        if (requestId !== requestIdRef.current) return;
        setPage((current) =>
          append ? { ...next, items: [...current.items, ...next.items] } : next,
        );
      } catch (caught) {
        if (requestId === requestIdRef.current) setError(messageOf(caught));
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [filterParams, selection],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!selection) {
        ++requestIdRef.current;
        setPage({ items: [], nextCursor: null });
        setError('');
        setLoading(false);
        return;
      }
      setPage({ items: [], nextCursor: null });
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, selection]);

  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(selection)}>
      <DialogContent className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 rounded-none p-0 sm:h-[88dvh] sm:max-w-3xl sm:rounded-2xl">
        {selection && (
          <>
            <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12">
              <DialogTitle className="break-words">
                {selection.row.label}
                {selection.dimension === 'product' &&
                  [selection.row.color, selection.row.memory].filter(Boolean)
                    .length > 0 && (
                    <span className="mt-1 block text-sm font-semibold text-muted-foreground">
                      {[selection.row.color, selection.row.memory]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
              </DialogTitle>
              <DialogDescription>
                {selection.row.saleCount}{' '}
                {selection.row.saleCount === 1 ? 'venda' : 'vendas'} ·{' '}
                {selection.row.itemCount}{' '}
                {selection.row.itemCount === 1 ? 'aparelho' : 'aparelhos'} ·{' '}
                {formatMoney(selection.row.totalCents)}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {error && page.items.length === 0 ? (
                <div
                  className="grid min-h-52 place-items-center p-6 text-center"
                  role="alert"
                >
                  <div>
                    <AlertTriangle className="mx-auto size-8 text-destructive" />
                    <p className="mt-3 text-sm font-semibold text-destructive">
                      {error}
                    </p>
                    <Button className="mt-3 h-11" onClick={() => void load()}>
                      Tentar novamente
                    </Button>
                  </div>
                </div>
              ) : loading && page.items.length === 0 ? (
                <output
                  aria-live="polite"
                  className="grid min-h-52 place-items-center text-sm font-semibold text-muted-foreground"
                >
                  <span className="flex items-center gap-2">
                    <LoaderCircle className="size-5 animate-spin text-primary" />
                    Carregando detalhes…
                  </span>
                </output>
              ) : page.items.length === 0 ? (
                <div className="grid min-h-52 place-items-center p-6 text-center text-sm text-muted-foreground">
                  Nenhum SN encontrado neste grupo.
                </div>
              ) : (
                <div className="divide-y">
                  {page.items.map((item) => (
                    <article className="px-4 py-3 sm:px-5" key={item.id}>
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">
                              #{String(item.saleNumber).padStart(5, '0')}
                            </Badge>
                            <strong className="truncate">
                              {item.productName}
                            </strong>
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {item.productDetail}
                          </p>
                          <p className="mt-1 font-mono text-sm font-bold">
                            SN {item.serial}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.customerName} · {item.sellerName} ·{' '}
                            {formatDateTime(item.saleCreatedAt)}
                          </p>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Vendido
                          </p>
                          <strong>{formatMoney(item.soldPriceCents)}</strong>
                          {onOpenSale && (
                            <Button
                              className="mt-2 block h-10"
                              size="sm"
                              variant="outline"
                              onClick={() => onOpenSale(item.saleId)}
                            >
                              Ver venda #
                              {String(item.saleNumber).padStart(5, '0')}
                            </Button>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                  {error && (
                    <div className="border-t bg-destructive/5 p-3 text-center">
                      <p className="text-sm font-semibold text-destructive">
                        {error}
                      </p>
                      <Button
                        className="mt-2"
                        onClick={() =>
                          void load(page.nextCursor, Boolean(page.nextCursor))
                        }
                        size="sm"
                        variant="outline"
                      >
                        Tentar novamente
                      </Button>
                    </div>
                  )}
                  {page.nextCursor && !error && (
                    <div className="flex justify-center p-3">
                      <Button
                        disabled={loading}
                        onClick={() => void load(page.nextCursor, true)}
                        size="sm"
                        variant="outline"
                      >
                        {loading && <LoaderCircle className="animate-spin" />}
                        Carregar mais
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <DialogFooter className="shrink-0 border-t bg-background p-3">
              <Button onClick={() => onOpenChange(false)} variant="outline">
                Fechar
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
