'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  LoaderCircle,
  Search,
  Smartphone,
  Trophy,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { PeriodFilter, localDateKey } from '@/components/pdv/period-filter';
import { ProductColorSwatch } from '@/components/pdv/product-color-swatch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GroupDetailsDialog } from '@/components/pdv/group-details-dialog';
import { messageOf, requestJson } from '@/lib/client-api';
import type {
  RankingDimension,
  RankingOrder,
  RankingPage,
  RankingRecord,
} from '@/lib/pdv-types';
import type { SalesPeriod } from '@/lib/server/sales-filters';
import { cn } from '@/lib/utils';

const dimensions = [
  {
    value: 'customer',
    label: 'Clientes',
    singular: 'cliente',
    icon: UsersRound,
  },
  {
    value: 'seller',
    label: 'Vendedores',
    singular: 'vendedor',
    icon: UserRound,
  },
  {
    value: 'product',
    label: 'Produtos',
    singular: 'produto',
    icon: Smartphone,
  },
] as const;
const emptyPage = (): RankingPage => ({
  items: [],
  nextOffset: null,
  totals: { participants: 0, itemCount: 0, amountCents: 0 },
});
const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function RankingProductionView({
  onOpenSale,
}: {
  onOpenSale: (id: string) => void;
}) {
  const [dimension, setDimension] = useState<RankingDimension>('customer');
  const [order, setOrder] = useState<RankingOrder>('items');
  const [period, setPeriod] = useState<SalesPeriod>('today');
  const [day, setDay] = useState(localDateKey);
  const [month, setMonth] = useState(() => localDateKey().slice(0, 7));
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(emptyPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<RankingRecord | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const params = new URLSearchParams({ dimension, order, period });
  if (period === 'day') params.set('day', day);
  if (period === 'month') params.set('month', month);
  const detailParams = params.toString();
  if (query) params.set('q', query);
  const filterKey = params.toString();

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(draft.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [draft]);
  const load = useCallback(
    async (offset = 0) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setLoading(true);
      setError('');
      if (!offset) setPage(emptyPage());
      try {
        const result = await requestJson<RankingPage>(
          `/api/rankings?${filterKey}&offset=${offset}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setPage((current) =>
          offset
            ? { ...result, items: [...current.items, ...result.items] }
            : result,
        );
      } catch (caught) {
        if (!controller.signal.aborted) setError(messageOf(caught));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [filterKey],
  );
  useEffect(() => {
    // Invalidate immediately so a previous filter's response cannot replace it.
    requestRef.current?.abort();
    const timer = window.setTimeout(() => {
      setSelected(null);
      void load();
    }, 0);
    const refresh = () => void load();
    window.addEventListener('pdv:sales-changed', refresh);
    return () => {
      requestRef.current?.abort();
      window.clearTimeout(timer);
      window.removeEventListener('pdv:sales-changed', refresh);
    };
  }, [load]);

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 overflow-hidden px-3 py-3 sm:px-6 lg:px-10 lg:py-5">
      <header className="flex shrink-0 items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-secondary text-primary">
          <Trophy />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ranking</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Compare clientes, vendedores e produtos no período.
          </p>
        </div>
      </header>
      <fieldset aria-label="Categoria do ranking" className="shrink-0">
        <div className="grid h-auto w-full grid-cols-3 rounded-xl bg-muted p-1 sm:max-w-lg">
          {dimensions.map(({ value, label, icon: Icon }) => (
            <Button
              className="min-h-11 gap-1.5 rounded-lg text-sm font-bold"
              key={value}
              variant={dimension === value ? 'default' : 'ghost'}
              aria-pressed={dimension === value}
              onClick={() => {
                setDimension(value);
                setDraft('');
                setQuery('');
              }}
            >
              <Icon className="hidden size-4 min-[380px]:block" />
              {label}
            </Button>
          ))}
        </div>
      </fieldset>
      <div className="grid shrink-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,auto)]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
          <Input
            aria-label={`Pesquisar ${dimensions.find((item) => item.value === dimension)?.label.toLowerCase()}`}
            className="h-11 rounded-xl pl-9"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={
              dimension === 'product'
                ? 'Modelo, cor ou memória'
                : 'Pesquisar nome'
            }
          />
        </div>
        <PeriodFilter
          period={period}
          day={day}
          month={month}
          onPeriod={setPeriod}
          onDay={setDay}
          onMonth={setMonth}
        />
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-sm">
        <fieldset
          className="flex items-center gap-1"
          aria-label="Ordenar ranking"
        >
          <span className="mr-1 hidden text-muted-foreground sm:inline">
            Ordenar
          </span>
          {(['items', 'value'] as const).map((value) => (
            <Button
              key={value}
              className="h-11 rounded-xl font-bold"
              size="sm"
              variant={order === value ? 'secondary' : 'ghost'}
              aria-pressed={order === value}
              onClick={() => setOrder(value)}
            >
              {value === 'items' ? 'Quantidade' : 'Valor'}
            </Button>
          ))}
        </fieldset>
        <p className="text-muted-foreground">
          {page.totals.participants}{' '}
          {page.totals.participants === 1
            ? dimensions.find((item) => item.value === dimension)?.singular
            : dimensions
                .find((item) => item.value === dimension)
                ?.label.toLowerCase()}{' '}
          · {page.totals.itemCount}{' '}
          {page.totals.itemCount === 1 ? 'aparelho' : 'aparelhos'}{' '}
          <strong className="ml-1 text-foreground">
            {money(page.totals.amountCents)}
          </strong>
        </p>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-2xl border bg-card"
        aria-busy={loading}
      >
        {loading && page.items.length === 0 ? (
          <output className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin" /> Carregando ranking…
          </output>
        ) : (
          <div className="divide-y">
            {page.items.map((row) => (
              <RankingRow
                key={row.key}
                row={row}
                dimension={dimension}
                onOpen={() => setSelected(row)}
              />
            ))}
          </div>
        )}
        {!loading && !error && !page.items.length && (
          <p className="px-5 py-12 text-center text-sm text-muted-foreground">
            Nenhuma venda concluída encontrada. Experimente outro período.
          </p>
        )}
        {error && (
          <div className="p-4 text-center" role="alert">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              className="mt-2"
              variant="outline"
              disabled={loading}
              onClick={() =>
                void load(page.items.length ? (page.nextOffset ?? 0) : 0)
              }
            >
              Tentar novamente
            </Button>
          </div>
        )}
        {page.nextOffset !== null && !error && (
          <div className="p-3 text-center">
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void load(page.nextOffset!)}
            >
              {loading ? 'Carregando…' : 'Mostrar mais'}
            </Button>
          </div>
        )}
      </div>
      <p className="shrink-0 text-xs text-muted-foreground">
        Canceladas não entram. Empates recebem a mesma posição.{' '}
        {dimension === 'product'
          ? 'Cada cor e memória é uma variação.'
          : 'Toque para ver compras e SNs.'}
      </p>
      {selected && (
        <GroupDetailsDialog
          key={`${dimension}:${selected.key}`}
          selection={{ dimension, row: selected }}
          filterParams={detailParams}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          onOpenSale={onOpenSale}
        />
      )}
    </section>
  );
}

function RankingRow({
  row,
  dimension,
  onOpen,
}: {
  row: RankingRecord;
  dimension: RankingDimension;
  onOpen: () => void;
}) {
  const award =
    row.position === 1
      ? 'Ouro'
      : row.position === 2
        ? 'Prata'
        : row.position === 3
          ? 'Bronze'
          : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-l-2 border-l-transparent p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:p-4',
        award === 'Ouro' && 'border-l-amber-500 bg-amber-500/[.045]',
        award === 'Prata' && 'border-l-slate-400 bg-slate-400/[.045]',
        award === 'Bronze' && 'border-l-orange-700 bg-orange-700/[.035]',
      )}
    >
      <span
        aria-label={
          award
            ? `${row.position}º lugar · Troféu de ${award.toLowerCase()}`
            : undefined
        }
        role={award ? 'img' : undefined}
        className={cn(
          'flex w-11 flex-col items-center gap-1',
          award === 'Ouro' && 'text-amber-700 dark:text-amber-300',
          award === 'Prata' && 'text-slate-600 dark:text-slate-300',
          award === 'Bronze' && 'text-orange-800 dark:text-orange-300',
        )}
      >
        {award ? (
          <>
            <span
              className={cn(
                'grid size-11 place-items-center rounded-xl',
                award === 'Ouro' && 'bg-amber-100 dark:bg-amber-400/10',
                award === 'Prata' && 'bg-slate-100 dark:bg-slate-300/10',
                award === 'Bronze' && 'bg-orange-100 dark:bg-orange-400/10',
              )}
            >
              <Trophy aria-hidden="true" className="size-6" />
            </span>
            <span
              aria-hidden="true"
              className="text-sm font-extrabold leading-none tabular-nums"
            >
              {row.position}º
            </span>
          </>
        ) : (
          <span className="grid size-11 place-items-center rounded-xl bg-secondary text-sm font-bold text-primary">
            {row.position}º
          </span>
        )}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <strong className="break-words text-base">{row.label}</strong>
        </div>
        {dimension === 'product' && (row.color || row.memory) && (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {row.color && (
              <ProductColorSwatch color={row.color} model={row.label} />
            )}
            {row.color}
            {row.memory && <Badge variant="secondary">{row.memory}</Badge>}
          </p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">
          {row.itemCount} {row.itemCount === 1 ? 'aparelho' : 'aparelhos'} ·{' '}
          {row.saleCount}{' '}
          {dimension === 'customer'
            ? row.saleCount === 1
              ? 'compra'
              : 'compras'
            : row.saleCount === 1
              ? 'venda'
              : 'vendas'}
        </p>
      </div>
      <div className="col-start-2 flex items-center justify-between gap-2 sm:col-auto sm:block sm:text-right">
        <div>
          <span className="mr-2 text-xs text-muted-foreground sm:mr-0 sm:block">
            {dimension === 'customer' ? 'Total comprado' : 'Total vendido'}
          </span>
          <strong className="text-base">{money(row.totalCents)}</strong>
        </div>
        <ArrowRight className="size-4 text-muted-foreground sm:hidden" />
      </div>
    </button>
  );
}
