'use client';

/* oxlint-disable next/no-img-element, jsx-a11y/label-has-associated-control -- report media is authenticated and the custom textarea is wrapped by its label */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Download,
  FileCheck2,
  FileText,
  ImagePlus,
  LoaderCircle,
  Paperclip,
  Pencil,
  Search,
  Smartphone,
  UserRound,
  WalletCards,
  XCircle,
} from 'lucide-react';

import { OrderStatusBadge } from '@/components/pdv/order-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { messageOf, requestJson } from '@/lib/client-api';
import {
  formatMediaBytes,
  MEDIA_LIMITS,
  prepareMediaSelection,
} from '@/lib/client-media';
import { createOperationId } from '@/lib/client-operation-id';
import { downloadReportPdf } from '@/lib/download-report-pdf';
import { parseMoneyInput } from '@/lib/money';
import { cn } from '@/lib/utils';
import type {
  BootstrapData,
  SalePaymentRecord,
  SaleRecord,
  SalesAnalytics,
  SalesGroupDetailPage,
  SalesGroupRecord,
  SalesGrouping,
  SalesPage,
} from '@/lib/pdv-types';

type PeriodFilter =
  | 'today'
  | 'yesterday'
  | '7d'
  | '15d'
  | 'day'
  | 'month'
  | 'all';
type Grouping = 'sale' | SalesGrouping;
type ReportLevel = 'simple' | 'detailed' | 'complete';
type SellerRanking = 'items' | 'value';
type SelectedGroup = {
  dimension: SalesGrouping;
  row: SalesGroupRecord;
};

const PERIOD_OPTIONS: Array<{ label: string; value: PeriodFilter }> = [
  { label: 'Hoje', value: 'today' },
  { label: 'Ontem', value: 'yesterday' },
  { label: 'Semana', value: '7d' },
  { label: '15 dias', value: '15d' },
  { label: 'Escolher dia', value: 'day' },
  { label: 'Mês escolhido', value: 'month' },
  { label: 'Todo período', value: 'all' },
];
const ANALYTICS_CACHE_MS = 5 * 60 * 1000;

function emptySalesPage(): SalesPage {
  return {
    items: [],
    groups: [],
    nextCursor: null,
    total: 0,
    aggregates: { amountCents: 0, itemCount: 0, alertCount: 0 },
  };
}

export function SalesProductionView({
  data,
  onChanged,
}: {
  data: BootstrapData;
  onChanged: () => Promise<void>;
}) {
  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<PeriodFilter>('today');
  const [selectedDay, setSelectedDay] = useState(() => dateKey(Date.now()));
  const [selectedMonth, setSelectedMonth] = useState(() =>
    dateKey(Date.now()).slice(0, 7),
  );
  const [grouping, setGrouping] = useState<Grouping>('sale');
  const [sellerRanking, setSellerRanking] = useState<SellerRanking>('items');
  const [selectedGroup, setSelectedGroup] = useState<SelectedGroup | null>(
    null,
  );
  const [reportSale, setReportSale] = useState<SaleRecord | null>(null);
  const [editSale, setEditSale] = useState<SaleRecord | null>(null);
  const [cancelSale, setCancelSale] = useState<SaleRecord | null>(null);
  const [page, setPage] = useState<SalesPage>(() => emptySalesPage());
  const [analyticsState, setAnalyticsState] = useState<{
    key: string;
    value: SalesAnalytics;
  } | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [analyticsError, setAnalyticsError] = useState('');
  const listRequestIdRef = useRef(0);
  const analyticsRequestIdRef = useRef(0);
  const listDataKeyRef = useRef('');
  const listPendingKeyRef = useRef('');
  const analyticsPendingKeyRef = useRef('');
  const analyticsCacheRef = useRef(
    new Map<string, { loadedAt: number; value: SalesAnalytics }>(),
  );
  const canCancel = data.user.role === 'owner' || data.user.role === 'admin';
  const filterParams = useMemo(() => {
    const params = new URLSearchParams({ period });
    if (period === 'day') params.set('day', selectedDay);
    if (period === 'month') params.set('month', selectedMonth);
    if (query) params.set('q', query);
    return params.toString();
  }, [period, query, selectedDay, selectedMonth]);
  const filterKey = filterParams;

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryDraft.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [queryDraft]);

  const loadSales = useCallback(
    async (cursor: string | null = null, append = false, force = false) => {
      const pendingKey = `${filterKey}|${cursor ?? 'first'}`;
      if (
        !force &&
        (listPendingKeyRef.current === pendingKey ||
          (!cursor && listDataKeyRef.current === filterKey))
      ) {
        return;
      }
      const requestId = ++listRequestIdRef.current;
      listPendingKeyRef.current = pendingKey;
      setListLoading(true);
      setListError('');
      if (!append && listDataKeyRef.current !== filterKey) {
        setPage(emptySalesPage());
      }
      try {
        const params = new URLSearchParams(filterParams);
        params.set('group', 'sale');
        params.set('limit', '50');
        if (cursor) params.set('cursor', cursor);
        const next = await requestJson<SalesPage>(
          `/api/sales?${params.toString()}`,
        );
        if (requestId !== listRequestIdRef.current) return;
        listDataKeyRef.current = filterKey;
        setPage((current) =>
          append ? { ...next, items: [...current.items, ...next.items] } : next,
        );
      } catch (error) {
        if (requestId === listRequestIdRef.current) {
          setListError(messageOf(error));
        }
      } finally {
        if (listPendingKeyRef.current === pendingKey) {
          listPendingKeyRef.current = '';
        }
        if (requestId === listRequestIdRef.current) setListLoading(false);
      }
    },
    [filterKey, filterParams],
  );

  const loadAnalytics = useCallback(
    async (force = false) => {
      const cached = analyticsCacheRef.current.get(filterKey);
      if (
        !force &&
        cached &&
        Date.now() - cached.loadedAt < ANALYTICS_CACHE_MS
      ) {
        setAnalyticsState({ key: filterKey, value: cached.value });
        setAnalyticsError('');
        return;
      }
      if (!force && analyticsPendingKeyRef.current === filterKey) return;
      const requestId = ++analyticsRequestIdRef.current;
      analyticsPendingKeyRef.current = filterKey;
      setAnalyticsLoading(true);
      setAnalyticsError('');
      if (analyticsState?.key !== filterKey) setAnalyticsState(null);
      try {
        const params = new URLSearchParams(filterParams);
        params.set('group', 'all');
        const next = await requestJson<SalesAnalytics>(
          `/api/sales?${params.toString()}`,
        );
        if (requestId !== analyticsRequestIdRef.current) return;
        if (analyticsCacheRef.current.size >= 12) {
          const oldestKey = analyticsCacheRef.current.keys().next().value;
          if (oldestKey) analyticsCacheRef.current.delete(oldestKey);
        }
        analyticsCacheRef.current.set(filterKey, {
          loadedAt: Date.now(),
          value: next,
        });
        setAnalyticsState({ key: filterKey, value: next });
      } catch (error) {
        if (requestId === analyticsRequestIdRef.current) {
          setAnalyticsError(messageOf(error));
        }
      } finally {
        if (analyticsPendingKeyRef.current === filterKey) {
          analyticsPendingKeyRef.current = '';
        }
        if (requestId === analyticsRequestIdRef.current) {
          setAnalyticsLoading(false);
        }
      }
    },
    [analyticsState?.key, filterKey, filterParams],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (grouping === 'sale') void loadSales();
      else void loadAnalytics();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [grouping, loadAnalytics, loadSales]);

  const analytics =
    analyticsState?.key === filterKey ? analyticsState.value : null;
  const groupRows = useMemo(() => {
    if (grouping === 'sale' || !analytics) return [];
    const rows = [...analytics.groups[grouping]];
    if (grouping === 'seller') {
      rows.sort((left, right) =>
        sellerRanking === 'items'
          ? left.itemCount - right.itemCount ||
            left.totalCents - right.totalCents
          : left.totalCents - right.totalCents ||
            left.itemCount - right.itemCount,
      );
      rows.reverse();
    }
    return rows;
  }, [analytics, grouping, sellerRanking]);
  const activeAggregates =
    grouping === 'sale'
      ? page.aggregates
      : (analytics?.aggregates ?? page.aggregates);
  const activeLoading = grouping === 'sale' ? listLoading : analyticsLoading;
  const activeError =
    grouping === 'sale'
      ? page.items.length === 0
        ? listError
        : ''
      : analyticsError;
  const activeCount =
    grouping === 'sale' ? page.items.length : groupRows.length;
  const activeTotal =
    grouping === 'sale' ? page.total : (analytics?.total ?? 0);

  const reloadActive = async () => {
    if (grouping === 'sale') await loadSales(null, false, true);
    else await loadAnalytics(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-3 py-3 sm:px-6 sm:py-5 lg:px-10">
      <div className="mb-3 shrink-0">
        <p className="eyebrow">Comercial</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-[-.04em] sm:text-3xl">
          Vendas
        </h1>
        <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
          Filtre o período, veja por venda, modelo, cliente ou vendedor e abra
          os SNs de cada grupo.
        </p>
      </div>
      <div className="mb-3 grid shrink-0 grid-cols-3 gap-2">
        <Metric
          label="Montante vendido"
          value={formatMoney(activeAggregates.amountCents)}
        />
        <Metric label="Aparelhos" value={String(activeAggregates.itemCount)} />
        <Metric
          label="Com diferença"
          value={String(activeAggregates.alertCount)}
        />
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 space-y-2 border-b p-3 sm:p-4">
          <div className="grid gap-2 xl:grid-cols-[minmax(16rem,1fr)_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 rounded-xl pl-9"
                onChange={(event) => setQueryDraft(event.target.value)}
                placeholder="Cliente, vendedor, modelo, venda ou SN"
                value={queryDraft}
              />
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1 sm:grid-cols-7">
              {PERIOD_OPTIONS.map((option) => (
                <Button
                  className="h-8 px-1.5 text-[.68rem] sm:px-2 sm:text-xs"
                  key={option.value}
                  onClick={() => setPeriod(option.value)}
                  size="sm"
                  variant={period === option.value ? 'default' : 'ghost'}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-[auto_1fr]">
            {(period === 'day' || period === 'month') && (
              <Input
                aria-label={
                  period === 'day' ? 'Dia das vendas' : 'Mês das vendas'
                }
                className="h-9 rounded-xl md:w-44"
                onChange={(event) => {
                  if (!event.target.value) return;
                  if (period === 'day') setSelectedDay(event.target.value);
                  else setSelectedMonth(event.target.value);
                }}
                type={period === 'day' ? 'date' : 'month'}
                value={period === 'day' ? selectedDay : selectedMonth}
              />
            )}
            <div className="grid grid-cols-4 gap-1 md:ml-auto md:w-[34rem]">
              {(
                [
                  ['sale', 'Por venda'],
                  ['model', 'Por modelo'],
                  ['customer', 'Por cliente'],
                  ['seller', 'Ranking'],
                ] as const
              ).map(([value, label]) => (
                <Button
                  className="h-9 px-1 text-[.7rem] sm:px-3 sm:text-sm"
                  key={value}
                  onClick={() => setGrouping(value)}
                  size="sm"
                  variant={grouping === value ? 'secondary' : 'ghost'}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          {grouping === 'seller' && (
            <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
              <span className="font-semibold">Ranking de vendedores</span>
              <Button
                className="h-7 px-2 text-xs"
                onClick={() => setSellerRanking('items')}
                size="sm"
                variant={sellerRanking === 'items' ? 'secondary' : 'ghost'}
              >
                Quantidade
              </Button>
              <Button
                className="h-7 px-2 text-xs"
                onClick={() => setSellerRanking('value')}
                size="sm"
                variant={sellerRanking === 'value' ? 'secondary' : 'ghost'}
              >
                Valor
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto p-0 overscroll-contain">
          {activeError ? (
            <div className="grid min-h-52 place-items-center p-6 text-center">
              <div>
                <AlertTriangle className="mx-auto size-8 text-destructive" />
                <p className="mt-3 text-sm font-semibold text-destructive">
                  {activeError}
                </p>
                <Button className="mt-3" onClick={() => void reloadActive()}>
                  Tentar novamente
                </Button>
              </div>
            </div>
          ) : activeLoading && activeCount === 0 ? (
            <div className="grid min-h-52 place-items-center">
              <LoaderCircle className="size-7 animate-spin text-primary" />
            </div>
          ) : activeCount === 0 ? (
            <Empty
              hasAny={Boolean(query) || period !== 'all' || activeTotal > 0}
            />
          ) : grouping === 'sale' ? (
            <>
              <SaleList
                canCancel={canCancel}
                onCancel={setCancelSale}
                onEdit={setEditSale}
                onReport={setReportSale}
                sales={page.items}
              />
              {listError && (
                <div className="border-t bg-destructive/5 p-3 text-center">
                  <p className="text-sm font-semibold text-destructive">
                    {listError}
                  </p>
                  <Button
                    className="mt-2"
                    onClick={() =>
                      void loadSales(
                        page.nextCursor,
                        Boolean(page.nextCursor),
                        true,
                      )
                    }
                    size="sm"
                    variant="outline"
                  >
                    Tentar novamente
                  </Button>
                </div>
              )}
              <div className="flex items-center justify-center gap-3 border-t p-3">
                <span className="text-xs text-muted-foreground">
                  {page.items.length} de {page.total}
                </span>
                {page.nextCursor && !listError && (
                  <Button
                    disabled={listLoading}
                    onClick={() => void loadSales(page.nextCursor, true)}
                    size="sm"
                    variant="outline"
                  >
                    {listLoading && <LoaderCircle className="animate-spin" />}
                    Carregar mais
                  </Button>
                )}
              </div>
            </>
          ) : (
            <GroupedList
              grouping={grouping}
              onOpen={(row) => setSelectedGroup({ dimension: grouping, row })}
              ranking={sellerRanking}
              rows={groupRows}
            />
          )}
        </CardContent>
      </Card>
      <SaleReport
        onOpenChange={(open) => {
          if (!open) setReportSale(null);
        }}
        sale={reportSale}
        storeName={data.store.name}
      />
      <EditSaleDialog
        data={data}
        key={editSale?.id ?? 'closed-sale-editor'}
        onChanged={async () => {
          await onChanged();
          analyticsCacheRef.current.clear();
          listDataKeyRef.current = '';
          setAnalyticsState(null);
          await loadSales(null, false, true);
        }}
        onOpenChange={(open) => {
          if (!open) setEditSale(null);
        }}
        sale={editSale}
      />
      <CancelDialog
        data={data}
        onChanged={async () => {
          await onChanged();
          analyticsCacheRef.current.clear();
          listDataKeyRef.current = '';
          setAnalyticsState(null);
          await reloadActive();
        }}
        onOpenChange={(open) => {
          if (!open) setCancelSale(null);
        }}
        sale={cancelSale}
      />
      <GroupDetailsDialog
        filterParams={filterParams}
        onOpenChange={(open) => {
          if (!open) setSelectedGroup(null);
        }}
        selection={selectedGroup}
      />
    </div>
  );
}

function SaleList({
  sales,
  canCancel,
  onEdit,
  onReport,
  onCancel,
}: {
  sales: SaleRecord[];
  canCancel: boolean;
  onEdit: (sale: SaleRecord) => void;
  onReport: (sale: SaleRecord) => void;
  onCancel: (sale: SaleRecord) => void;
}) {
  return (
    <div className="divide-y">
      {sales.map((sale) => (
        <article
          className={
            sale.status === 'cancelled'
              ? 'bg-muted/35 px-4 py-3 opacity-75 sm:px-5'
              : 'px-4 py-3 sm:px-5'
          }
          key={sale.id}
        >
          <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <div className="flex items-center gap-2 sm:block">
              <Badge
                variant={
                  sale.status === 'cancelled' ? 'destructive' : 'secondary'
                }
              >
                #{String(sale.number).padStart(5, '0')}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(sale.createdAt)}
              </span>
            </div>
            <div className="min-w-0">
              <p className="truncate font-bold">{sale.customerName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {sale.items.length}{' '}
                {sale.items.length === 1 ? 'aparelho' : 'aparelhos'} ·{' '}
                {sale.sellerName} · {paymentLabel(sale)}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {sale.orderStatus && (
                  <OrderStatusBadge status={sale.orderStatus} />
                )}
                {sale.receivedDifferenceCents !== 0 && (
                  <WarningBadge
                    text={`${sale.receivedDifferenceCents > 0 ? 'Recebido acima' : 'Recebido abaixo'} em ${formatMoney(Math.abs(sale.receivedDifferenceCents))}`}
                  />
                )}
                {sale.priceDifferenceCents !== 0 && (
                  <WarningBadge
                    text={`${sale.priceDifferenceCents > 0 ? 'Preço acima' : 'Preço abaixo'} do cadastrado`}
                  />
                )}
                {sale.status === 'cancelled' && sale.cancellationReason && (
                  <span className="text-xs font-semibold text-destructive">
                    Motivo: {sale.cancellationReason}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
              <div className="mr-2 text-right">
                <p className="text-[.65rem] font-bold uppercase text-muted-foreground">
                  Recebido
                </p>
                <strong>{formatMoney(sale.receivedTotalCents)}</strong>
              </div>
              <Button
                onClick={() => onReport(sale)}
                size="sm"
                variant="outline"
              >
                <FileText /> Relatório
              </Button>
              {sale.status === 'completed' && (
                <Button
                  onClick={() => onEdit(sale)}
                  size="sm"
                  variant="outline"
                >
                  <Pencil /> Editar
                </Button>
              )}
              {canCancel && sale.status === 'completed' && (
                <Button
                  aria-label="Cancelar venda"
                  onClick={() => onCancel(sale)}
                  size="icon"
                  variant="ghost"
                >
                  <XCircle />
                </Button>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function GroupedList({
  rows,
  grouping,
  ranking,
  onOpen,
}: {
  rows: SalesGroupRecord[];
  grouping: SalesGrouping;
  ranking: SellerRanking;
  onOpen: (row: SalesGroupRecord) => void;
}) {
  return (
    <div className="divide-y">
      {rows.map((row) => (
        <button
          className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5"
          key={row.key}
          onClick={() => onOpen(row)}
          type="button"
        >
          <span className="grid size-11 place-items-center rounded-xl bg-secondary text-primary">
            {grouping === 'model' ? (
              <Smartphone className="size-5" />
            ) : (
              <UserRound className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              {grouping === 'seller' && (
                <Badge variant="secondary">
                  #{ranking === 'items' ? row.rankByItems : row.rankByValue}
                </Badge>
              )}
              <p className="truncate font-bold">{row.label}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {row.saleCount} {row.saleCount === 1 ? 'venda' : 'vendas'} ·{' '}
              {row.itemCount} {row.itemCount === 1 ? 'aparelho' : 'aparelhos'}
            </p>
            <p className="mt-0.5 text-[.68rem] font-semibold text-primary">
              Ver vendas e SNs
            </p>
          </div>
          <div className="text-right">
            <p className="text-[0.65rem] font-bold uppercase tracking-wider text-muted-foreground">
              Vendido
            </p>
            <strong>{formatMoney(row.totalCents)}</strong>
          </div>
        </button>
      ))}
    </div>
  );
}

function GroupDetailsDialog({
  selection,
  filterParams,
  onOpenChange,
}: {
  selection: SelectedGroup | null;
  filterParams: string;
  onOpenChange: (open: boolean) => void;
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
              <DialogTitle className="truncate">
                {selection.row.label}
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
                <div className="grid min-h-52 place-items-center p-6 text-center">
                  <div>
                    <AlertTriangle className="mx-auto size-8 text-destructive" />
                    <p className="mt-3 text-sm font-semibold text-destructive">
                      {error}
                    </p>
                    <Button className="mt-3" onClick={() => void load()}>
                      Tentar novamente
                    </Button>
                  </div>
                </div>
              ) : loading && page.items.length === 0 ? (
                <div className="grid min-h-52 place-items-center">
                  <LoaderCircle className="size-7 animate-spin text-primary" />
                </div>
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
                          <p className="text-[.65rem] font-bold uppercase tracking-wider text-muted-foreground">
                            Vendido
                          </p>
                          <strong>{formatMoney(item.soldPriceCents)}</strong>
                          {item.referencePriceCents !== item.soldPriceCents && (
                            <p className="text-[.68rem] font-semibold text-amber-800">
                              Cadastrado {formatMoney(item.referencePriceCents)}
                            </p>
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

function EditSaleDialog({
  sale,
  data,
  onOpenChange,
  onChanged,
}: {
  sale: SaleRecord | null;
  data: BootstrapData;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const initialStatusId = sale?.orderStatus?.id ?? '';
  const [selectedStatusId, setSelectedStatusId] = useState(initialStatusId);
  const [currentStatusId, setCurrentStatusId] = useState(initialStatusId);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [itemFiles, setItemFiles] = useState<Record<string, File[]>>({});
  const [preparing, setPreparing] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'cash' | ''>('');
  const [paymentPixAccountId, setPaymentPixAccountId] = useState(
    () => data.pixAccounts.find((account) => account.active)?.id ?? '',
  );
  const [paymentAmount, setPaymentAmount] = useState(() =>
    formatMoneyInput(Math.max(0, -(sale?.receivedDifferenceCents ?? 0))),
  );
  const paymentOperationIdRef = useRef(createOperationId());
  const [visiblePayments, setVisiblePayments] = useState<SalePaymentRecord[]>(
    () => sale?.payments ?? [],
  );
  const [pendingPaymentCents, setPendingPaymentCents] = useState(() =>
    Math.max(0, -(sale?.receivedDifferenceCents ?? 0)),
  );
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const existingAttachmentCount = sale
    ? sale.receipts.length +
      sale.items.reduce((total, item) => total + item.photos.length, 0)
    : 0;
  const existingAttachmentBytes = sale
    ? sale.receipts.reduce((total, file) => total + file.sizeBytes, 0) +
      sale.items.reduce(
        (total, item) =>
          total + item.photos.reduce((sum, file) => sum + file.sizeBytes, 0),
        0,
      )
    : 0;
  const selectedItemFiles = Object.values(itemFiles).flat();
  const selectedFiles = [...receiptFiles, ...selectedItemFiles];
  const remainingAttachmentCount = Math.max(
    0,
    MEDIA_LIMITS.saleFiles - existingAttachmentCount,
  );
  const remainingAttachmentBytes = Math.max(
    0,
    MEDIA_LIMITS.maxOperationBytes - existingAttachmentBytes,
  );
  const availableStatuses = data.orderStatuses.filter(
    (status) => status.active || status.id === currentStatusId,
  );
  const activePixAccounts = data.pixAccounts.filter(
    (account) => account.active,
  );
  const additionalPaymentCents = parseMoneyInput(paymentAmount);
  const paymentReady =
    paymentMethod !== '' &&
    additionalPaymentCents > 0 &&
    additionalPaymentCents <= pendingPaymentCents &&
    (paymentMethod !== 'pix' || Boolean(paymentPixAccountId));

  const prepareReceipts = async (incoming: File[]) => {
    if (!sale || incoming.length === 0) return;
    setPreparing(true);
    setError('');
    setNotice('');
    try {
      const result = await prepareMediaSelection({
        current: receiptFiles,
        incoming,
        maxFiles: Math.max(0, MEDIA_LIMITS.saleReceipts - sale.receipts.length),
        allowPdf: true,
        otherFiles: selectedItemFiles,
        maxCombinedFiles: remainingAttachmentCount,
        maxTotalBytes: remainingAttachmentBytes,
      });
      setReceiptFiles(result.files);
      setNotice(mediaPreparationMessage(result));
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPreparing(false);
    }
  };

  const prepareItemPhotos = async (itemId: string, incoming: File[]) => {
    if (!sale || incoming.length === 0) return;
    const item = sale.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    setPreparing(true);
    setError('');
    setNotice('');
    try {
      const current = itemFiles[itemId] ?? [];
      const otherFiles = [
        ...receiptFiles,
        ...Object.entries(itemFiles)
          .filter(([candidateId]) => candidateId !== itemId)
          .flatMap(([, files]) => files),
      ];
      const result = await prepareMediaSelection({
        current,
        incoming,
        maxFiles: Math.max(0, MEDIA_LIMITS.saleItemPhotos - item.photos.length),
        otherFiles,
        maxCombinedFiles: remainingAttachmentCount,
        maxTotalBytes: remainingAttachmentBytes,
      });
      setItemFiles((values) => ({ ...values, [itemId]: result.files }));
      setNotice(mediaPreparationMessage(result));
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPreparing(false);
    }
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && (preparing || uploadBusy)) return;
        onOpenChange(open);
      }}
      open={Boolean(sale)}
    >
      <DialogContent
        className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 pt-[env(safe-area-inset-top)] [&_[data-slot=dialog-close]]:top-[calc(.5rem+env(safe-area-inset-top))] sm:h-[92dvh] sm:max-w-3xl sm:rounded-2xl sm:pt-0 sm:[&_[data-slot=dialog-close]]:top-2"
        showCloseButton={!preparing && !uploadBusy}
      >
        {sale && (
          <>
            <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12">
              <DialogTitle>
                Editar venda #{String(sale.number).padStart(5, '0')}
              </DialogTitle>
              <DialogDescription>
                Altere o acompanhamento, complete um pagamento pendente ou
                acrescente anexos. Cliente, produtos e preços permanecem
                protegidos.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 overscroll-contain sm:p-5">
              {notice && (
                <output
                  aria-live="polite"
                  className="block rounded-xl bg-success/10 p-3 text-sm font-semibold text-success"
                >
                  {notice}
                </output>
              )}

              <section className="rounded-2xl border p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                    <FileCheck2 className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-extrabold">Status do pedido</h3>
                    <p className="text-xs text-muted-foreground">
                      Não altera o estoque nem o cancelamento da venda.
                    </p>
                  </div>
                </div>
                <div className="mt-3">
                  <NativeSelect
                    aria-label="Status do pedido desta venda"
                    className="h-11 w-full [&_select]:h-11"
                    onChange={(event) =>
                      setSelectedStatusId(event.target.value)
                    }
                    value={selectedStatusId}
                  >
                    <NativeSelectOption value="">Sem status</NativeSelectOption>
                    {availableStatuses.map((status) => (
                      <NativeSelectOption key={status.id} value={status.id}>
                        {status.name}
                        {status.active ? '' : ' (inativo)'}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                {selectedStatusId !== currentStatusId && (
                  <p className="mt-2 text-xs font-semibold text-primary">
                    O novo status será aplicado ao salvar as alterações.
                  </p>
                )}
                {data.orderStatuses.length === 0 && (
                  <p className="mt-2 text-xs font-semibold text-amber-800">
                    Cadastre seus status em Ajustes › Financeiro › Status do
                    pedido.
                  </p>
                )}
              </section>

              {pendingPaymentCents > 0 && (
                <section className="rounded-2xl border border-amber-500/35 bg-amber-50/60 p-4 dark:bg-amber-500/5">
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-900 dark:text-amber-200">
                      <WalletCards className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-extrabold">Completar pagamento</h3>
                      <p className="text-xs text-muted-foreground">
                        Os pagamentos anteriores permanecem registrados. O saldo
                        pendente é {formatMoney(pendingPaymentCents)}.
                      </p>
                    </div>
                  </div>

                  {visiblePayments.length > 0 && (
                    <div className="mt-3 space-y-1 rounded-xl bg-background/80 p-3 text-xs">
                      {visiblePayments.map((payment) => (
                        <div
                          className="flex items-center justify-between gap-3"
                          key={payment.id}
                        >
                          <span className="truncate text-muted-foreground">
                            {payment.method === 'pix'
                              ? `Pix${payment.accountName ? ` · ${payment.accountName}` : ''}`
                              : 'Dinheiro'}
                          </span>
                          <strong>{formatMoney(payment.amountCents)}</strong>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div>
                      <label
                        className="text-sm font-semibold"
                        htmlFor={`sale-${sale.id}-payment-method`}
                      >
                        Forma do novo pagamento
                      </label>
                      <NativeSelect
                        className="mt-1 h-11 w-full [&_select]:h-11"
                        id={`sale-${sale.id}-payment-method`}
                        onChange={(event) =>
                          setPaymentMethod(
                            event.target.value as 'pix' | 'cash' | '',
                          )
                        }
                        value={paymentMethod}
                      >
                        <NativeSelectOption value="">
                          Selecione
                        </NativeSelectOption>
                        <NativeSelectOption
                          disabled={activePixAccounts.length === 0}
                          value="pix"
                        >
                          Pix
                        </NativeSelectOption>
                        <NativeSelectOption value="cash">
                          Dinheiro
                        </NativeSelectOption>
                      </NativeSelect>
                    </div>
                    <div>
                      <label
                        className="text-sm font-semibold"
                        htmlFor={`sale-${sale.id}-payment-amount`}
                      >
                        Valor a acrescentar
                      </label>
                      <Input
                        aria-describedby={
                          paymentMethod && !paymentReady
                            ? `sale-${sale.id}-payment-error`
                            : undefined
                        }
                        aria-invalid={Boolean(paymentMethod && !paymentReady)}
                        className="mt-1 h-11 text-right font-bold"
                        id={`sale-${sale.id}-payment-amount`}
                        inputMode="decimal"
                        onChange={(event) =>
                          setPaymentAmount(event.target.value)
                        }
                        value={paymentAmount}
                      />
                    </div>
                  </div>

                  {paymentMethod === 'pix' && (
                    <div className="mt-2">
                      <label
                        className="text-sm font-semibold"
                        htmlFor={`sale-${sale.id}-payment-account`}
                      >
                        Conta Pix
                      </label>
                      <NativeSelect
                        className="mt-1 h-11 w-full [&_select]:h-11"
                        id={`sale-${sale.id}-payment-account`}
                        onChange={(event) =>
                          setPaymentPixAccountId(event.target.value)
                        }
                        value={paymentPixAccountId}
                      >
                        {activePixAccounts.length === 0 && (
                          <NativeSelectOption value="">
                            Cadastre uma conta Pix ativa
                          </NativeSelectOption>
                        )}
                        {activePixAccounts.map((account) => (
                          <NativeSelectOption
                            key={account.id}
                            value={account.id}
                          >
                            {account.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </div>
                  )}

                  {paymentMethod && !paymentReady && (
                    <p
                      aria-live="polite"
                      className="mt-2 text-xs font-semibold text-destructive"
                      id={`sale-${sale.id}-payment-error`}
                    >
                      Informe um valor entre R$ 0,01 e{' '}
                      {formatMoney(pendingPaymentCents)}
                      {paymentMethod === 'pix' && !paymentPixAccountId
                        ? ' e selecione uma conta Pix.'
                        : '.'}
                    </p>
                  )}
                </section>
              )}

              <section className="rounded-2xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                      <Paperclip className="size-5" />
                    </span>
                    <div>
                      <h3 className="font-extrabold">Comprovantes</h3>
                      <p className="text-xs text-muted-foreground">
                        Foto, imagem ou PDF · {sale.receipts.length} de{' '}
                        {MEDIA_LIMITS.saleReceipts} já anexados
                      </p>
                    </div>
                  </div>
                  <MediaPickerButtons
                    accessibleLabel="comprovantes da venda"
                    allowPdf
                    disabled={
                      preparing ||
                      uploadBusy ||
                      sale.receipts.length + receiptFiles.length >=
                        MEDIA_LIMITS.saleReceipts ||
                      remainingAttachmentCount <= selectedFiles.length
                    }
                    id={`sale-${sale.id}-receipts`}
                    onFiles={prepareReceipts}
                  />
                </div>
                {sale.receipts.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {sale.receipts.map((receipt) => (
                      <a
                        className="max-w-full truncate rounded-lg border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
                        href={receipt.url}
                        key={receipt.id}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {receipt.name}
                      </a>
                    ))}
                  </div>
                )}
                {receiptFiles.length > 0 && (
                  <SelectedFiles
                    files={receiptFiles}
                    onClear={() => setReceiptFiles([])}
                  />
                )}
              </section>

              <section className="rounded-2xl border p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                    <ImagePlus className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-extrabold">Fotos dos aparelhos</h3>
                    <p className="text-xs text-muted-foreground">
                      A foto fica vinculada ao SN correto da venda.
                    </p>
                  </div>
                </div>
                <div className="mt-3 divide-y rounded-xl border">
                  {sale.items.map((item) => {
                    const selected = itemFiles[item.id] ?? [];
                    return (
                      <div className="p-3" key={item.id}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-bold">
                              {item.productName}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {item.productDetail} · SN {item.serial}
                            </p>
                            <p className="mt-0.5 text-xs font-semibold">
                              {item.photos.length} de{' '}
                              {MEDIA_LIMITS.saleItemPhotos} fotos anexadas
                            </p>
                          </div>
                          <MediaPickerButtons
                            accessibleLabel={`fotos do aparelho ${item.productName}, SN ${item.serial}`}
                            disabled={
                              preparing ||
                              uploadBusy ||
                              item.photos.length + selected.length >=
                                MEDIA_LIMITS.saleItemPhotos ||
                              remainingAttachmentCount <= selectedFiles.length
                            }
                            id={`sale-${sale.id}-item-${item.id}`}
                            onFiles={(files) =>
                              prepareItemPhotos(item.id, files)
                            }
                          />
                        </div>
                        {item.photos.length > 0 && (
                          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                            {item.photos.map((photo) => (
                              <a
                                href={photo.url}
                                key={photo.id}
                                rel="noreferrer"
                                target="_blank"
                              >
                                <img
                                  alt={photo.name}
                                  className="size-16 rounded-lg border object-cover"
                                  decoding="async"
                                  loading="lazy"
                                  src={photo.url}
                                />
                              </a>
                            ))}
                          </div>
                        )}
                        {selected.length > 0 && (
                          <SelectedFiles
                            files={selected}
                            onClear={() =>
                              setItemFiles((values) => {
                                const next = { ...values };
                                delete next[item.id];
                                return next;
                              })
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <div className="rounded-xl bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                <strong className="text-foreground">
                  {selectedFiles.length} novo(s) anexo(s)
                </strong>{' '}
                ·{' '}
                {formatMediaBytes(
                  selectedFiles.reduce((sum, file) => sum + file.size, 0),
                )}
                {' · '}
                {existingAttachmentCount} já salvos nesta venda
              </div>
            </div>
            <DialogFooter className="m-0 shrink-0 flex-col rounded-none border-t bg-background p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] sm:flex-col">
              {error && (
                <p
                  className="w-full rounded-xl bg-destructive/10 p-2.5 text-left text-sm font-semibold whitespace-normal text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              )}
              <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  disabled={preparing || uploadBusy}
                  onClick={() => onOpenChange(false)}
                  variant="outline"
                >
                  Fechar
                </Button>
                <Button
                  className="h-10"
                  disabled={
                    preparing ||
                    uploadBusy ||
                    (paymentMethod !== '' && !paymentReady) ||
                    (selectedFiles.length === 0 &&
                      selectedStatusId === currentStatusId &&
                      paymentMethod === '')
                  }
                  onClick={async () => {
                    setUploadBusy(true);
                    setError('');
                    setNotice('');
                    let statusSaved = false;
                    let paymentSaved = false;
                    try {
                      if (paymentMethod && paymentReady) {
                        const result = await requestJson<{
                          payment: SalePaymentRecord;
                          sale: { receivedDifferenceCents: number };
                        }>(`/api/sales/${sale.id}/payments`, {
                          method: 'POST',
                          headers: {
                            'content-type': 'application/json',
                            'x-csrf-token': data.csrfToken,
                          },
                          body: JSON.stringify({
                            operationId: paymentOperationIdRef.current,
                            method: paymentMethod,
                            pixAccountId:
                              paymentMethod === 'pix'
                                ? paymentPixAccountId
                                : null,
                            amountCents: additionalPaymentCents,
                          }),
                        });
                        paymentSaved = true;
                        const nextPending = Math.max(
                          0,
                          -result.sale.receivedDifferenceCents,
                        );
                        setVisiblePayments((current) =>
                          current.some(
                            (payment) => payment.id === result.payment.id,
                          )
                            ? current
                            : [...current, result.payment],
                        );
                        setPendingPaymentCents(nextPending);
                        setPaymentAmount(formatMoneyInput(nextPending));
                        setPaymentMethod('');
                        paymentOperationIdRef.current = createOperationId();
                      }
                      if (selectedStatusId !== currentStatusId) {
                        await requestJson(
                          `/api/sales/${sale.id}/order-status`,
                          {
                            method: 'PATCH',
                            headers: {
                              'content-type': 'application/json',
                              'x-csrf-token': data.csrfToken,
                            },
                            body: JSON.stringify({
                              orderStatusId: selectedStatusId || null,
                            }),
                          },
                        );
                        statusSaved = true;
                        setCurrentStatusId(selectedStatusId);
                      }
                      if (selectedFiles.length > 0) {
                        const form = new FormData();
                        receiptFiles.forEach((file) =>
                          form.append('receipts', file),
                        );
                        Object.entries(itemFiles).forEach(([itemId, files]) => {
                          files.forEach((file) =>
                            form.append(`itemPhotos:${itemId}`, file),
                          );
                        });
                        await requestJson(`/api/sales/${sale.id}/attachments`, {
                          method: 'POST',
                          headers: { 'x-csrf-token': data.csrfToken },
                          body: form,
                        });
                      }
                      void onChanged();
                      onOpenChange(false);
                    } catch (caught) {
                      const savedParts = [
                        paymentSaved ? 'o pagamento' : '',
                        statusSaved ? 'o status' : '',
                      ].filter(Boolean);
                      if (savedParts.length > 0) void onChanged();
                      setError(
                        savedParts.length > 0
                          ? `${savedParts.join(' e ')} ${savedParts.length === 1 ? 'foi salvo' : 'foram salvos'}, mas faltou concluir o restante: ${messageOf(caught)}`
                          : messageOf(caught),
                      );
                    } finally {
                      setUploadBusy(false);
                    }
                  }}
                >
                  {uploadBusy ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Paperclip />
                  )}
                  {uploadBusy
                    ? 'Salvando alterações…'
                    : preparing
                      ? 'Preparando fotos…'
                      : 'Salvar alterações'}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MediaPickerButtons({
  id,
  accessibleLabel,
  allowPdf = false,
  disabled,
  onFiles,
}: {
  id: string;
  accessibleLabel: string;
  allowPdf?: boolean;
  disabled: boolean;
  onFiles: (files: File[]) => Promise<void>;
}) {
  const inputClassName = 'sr-only';
  const labelClassName = cn(
    buttonVariants({ size: 'lg', variant: 'outline' }),
    'h-11 px-3 focus-within:ring-3 focus-within:ring-ring/50',
    disabled && 'pointer-events-none opacity-50',
  );
  const handle = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) void onFiles(files);
  };
  return (
    <div className="flex shrink-0 gap-1">
      <label
        aria-label={`Tirar foto para ${accessibleLabel}`}
        aria-disabled={disabled}
        className={labelClassName}
        htmlFor={`${id}-camera`}
      >
        <Camera /> Foto
        <input
          accept="image/*"
          capture="environment"
          className={inputClassName}
          disabled={disabled}
          id={`${id}-camera`}
          onChange={(event) => handle(event.currentTarget)}
          type="file"
        />
      </label>
      <label
        aria-label={`Anexar arquivo em ${accessibleLabel}`}
        aria-disabled={disabled}
        className={labelClassName}
        htmlFor={`${id}-files`}
      >
        <Paperclip /> Anexar
        <input
          accept={allowPdf ? 'image/*,application/pdf' : 'image/*'}
          className={inputClassName}
          disabled={disabled}
          id={`${id}-files`}
          multiple
          onChange={(event) => handle(event.currentTarget)}
          type="file"
        />
      </label>
    </div>
  );
}

function SelectedFiles({
  files,
  onClear,
}: {
  files: File[];
  onClear: () => void;
}) {
  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-secondary/60 px-3 py-2 text-xs">
      <span className="min-w-0 truncate font-semibold">
        {files.length} selecionado(s) ·{' '}
        {formatMediaBytes(files.reduce((sum, file) => sum + file.size, 0))}
      </span>
      <Button className="shrink-0" onClick={onClear} size="xs" variant="ghost">
        Limpar
      </Button>
    </div>
  );
}

function mediaPreparationMessage(result: {
  addedCount: number;
  duplicateCount: number;
  optimizedCount: number;
  bytesSaved: number;
}) {
  const parts = [`${result.addedCount} arquivo(s) preparado(s)`];
  if (result.optimizedCount > 0) {
    parts.push(
      `${result.optimizedCount} foto(s) otimizada(s), economizando ${formatMediaBytes(result.bytesSaved)}`,
    );
  }
  if (result.duplicateCount > 0) {
    parts.push(`${result.duplicateCount} repetido(s) ignorado(s)`);
  }
  return `${parts.join(' · ')}.`;
}

function SaleReport({
  sale,
  storeName,
  onOpenChange,
}: {
  sale: SaleRecord | null;
  storeName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [level, setLevel] = useState<ReportLevel>('simple');
  const [includePhotos, setIncludePhotos] = useState(false);
  const [includeReceipts, setIncludeReceipts] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const reportRef = useRef<HTMLElement | null>(null);
  const modelGroups = useMemo(() => groupModels(sale), [sale]);
  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(sale)}>
      <DialogContent className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 rounded-none p-0 sm:h-[92dvh] sm:max-w-4xl sm:rounded-2xl">
        {sale && (
          <>
            <DialogHeader
              className="shrink-0 border-b px-4 py-3 pr-12"
              data-report-controls
            >
              <DialogTitle>
                Relatório da venda #{String(sale.number).padStart(5, '0')}
              </DialogTitle>
              <DialogDescription>
                O conteúdo permanece separado desta venda.
              </DialogDescription>
            </DialogHeader>
            <div
              className="grid shrink-0 grid-cols-3 gap-1 border-b bg-muted/30 p-2 sm:p-3"
              data-report-controls
            >
              {(['simple', 'detailed', 'complete'] as const).map((value) => (
                <Button
                  className="h-10 px-2 text-xs sm:text-sm"
                  key={value}
                  onClick={() => {
                    setLevel(value);
                    if (value === 'complete') {
                      setIncludePhotos(true);
                      setIncludeReceipts(true);
                    }
                  }}
                  variant={level === value ? 'default' : 'outline'}
                >
                  {value === 'simple'
                    ? 'Simplificado'
                    : value === 'detailed'
                      ? 'Detalhado'
                      : 'Completo'}
                </Button>
              ))}
              <Button
                className="h-9 sm:col-span-1"
                onClick={() => setIncludePhotos((value) => !value)}
                size="sm"
                variant={includePhotos ? 'secondary' : 'ghost'}
              >
                <Camera /> Fotos
              </Button>
              <Button
                className="h-9 sm:col-span-1"
                onClick={() => setIncludeReceipts((value) => !value)}
                size="sm"
                variant={includeReceipts ? 'secondary' : 'ghost'}
              >
                <FileCheck2 /> Comprovantes
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-muted/25 p-3 overscroll-contain sm:p-5">
              <article
                className="report-document mx-auto max-w-3xl rounded-2xl bg-white p-4 text-slate-950 shadow-sm ring-1 ring-slate-200 sm:p-7"
                data-print-report
                ref={reportRef}
              >
                <header className="border-b border-slate-200 pb-4">
                  <p className="text-xs font-bold uppercase tracking-[.16em] text-slate-500">
                    {storeName}
                  </p>
                  <h2 className="mt-1 text-xl font-extrabold">
                    Venda #{String(sale.number).padStart(5, '0')} ·{' '}
                    {reportName(level)}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {formatDateTime(sale.createdAt)} ·{' '}
                    {sale.status === 'cancelled' ? 'Cancelada' : 'Concluída'}
                  </p>
                  {sale.orderStatus && (
                    <div className="mt-2">
                      <OrderStatusBadge status={sale.orderStatus} />
                    </div>
                  )}
                </header>
                <div className="report-section mt-4 grid grid-cols-3 gap-2">
                  <ReportMetric
                    label="Montante vendido"
                    value={formatMoney(sale.productsTotalCents)}
                  />
                  <ReportMetric
                    label="Aparelhos"
                    value={String(sale.items.length)}
                  />
                  <ReportMetric label="Cliente" value={sale.customerName} />
                </div>
                {sale.receivedDifferenceCents !== 0 && (
                  <p className="report-section mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
                    Produtos: {formatMoney(sale.productsTotalCents)} · Recebido{' '}
                    {sale.receivedDifferenceCents > 0 ? 'acima' : 'abaixo'} em{' '}
                    {formatMoney(Math.abs(sale.receivedDifferenceCents))}.
                  </p>
                )}
                <section className="report-section mt-5">
                  <h3 className="font-extrabold">Quantidade por aparelho</h3>
                  <div className="mt-2 space-y-2">
                    {modelGroups.map((group) => (
                      <div
                        className="report-row rounded-lg border border-slate-200 p-3"
                        key={group.key}
                      >
                        <div className="flex justify-between gap-3">
                          <span>
                            <strong>{group.name}</strong>
                            <span className="block text-xs text-slate-600">
                              {group.detail}
                            </span>
                          </span>
                          <strong>{group.items.length}</strong>
                        </div>
                        {level !== 'simple' && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {group.items.map((item) => (
                              <code
                                className="rounded bg-slate-100 px-2 py-1 text-xs"
                                key={item.serial}
                              >
                                {item.serial}
                              </code>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
                <section className="report-section mt-5">
                  <h3 className="font-extrabold">Produtos e valores</h3>
                  <div className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200">
                    {sale.items.map((item) => (
                      <div className="report-row p-3" key={item.id}>
                        <div className="flex justify-between gap-3">
                          <div>
                            <p className="font-bold">{item.productName}</p>
                            <p className="text-sm text-slate-600">
                              {item.productDetail}
                              {level !== 'simple' ? ` · SN ${item.serial}` : ''}
                            </p>
                          </div>
                          <strong>{formatMoney(item.soldPriceCents)}</strong>
                        </div>
                        {includePhotos && item.photos.length > 0 && (
                          <div className="mt-3 grid grid-cols-3 gap-2">
                            {item.photos.map((photo) => (
                              <a
                                className="report-row"
                                href={photo.url}
                                key={photo.id}
                                rel="noreferrer"
                                target="_blank"
                              >
                                <img
                                  alt={photo.name}
                                  className="aspect-square w-full rounded-lg border border-slate-200 object-cover"
                                  src={photo.url}
                                />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
                {level !== 'simple' && (
                  <section className="report-section mt-5">
                    <h3 className="font-extrabold">Formas de pagamento</h3>
                    <div className="mt-2 space-y-2">
                      {sale.payments.map((payment) => (
                        <div
                          className="report-row flex justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          key={payment.id}
                        >
                          <span>
                            {payment.method === 'pix'
                              ? `Pix${payment.accountName ? ` · ${payment.accountName}` : ''}`
                              : 'Dinheiro'}
                          </span>
                          <strong>{formatMoney(payment.amountCents)}</strong>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                {includeReceipts && sale.receipts.length > 0 && (
                  <section className="report-section mt-5">
                    <h3 className="font-extrabold">
                      Comprovantes da venda #
                      {String(sale.number).padStart(5, '0')}
                    </h3>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {sale.receipts.map((receipt) =>
                        receipt.mimeType === 'application/pdf' ? (
                          <a
                            className="report-row rounded-lg border border-slate-200 p-4 text-sm font-bold"
                            href={receipt.url}
                            key={receipt.id}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <FileText className="mb-2" />
                            {receipt.name}
                          </a>
                        ) : (
                          <a
                            className="report-row"
                            href={receipt.url}
                            key={receipt.id}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <img
                              alt={receipt.name}
                              className="aspect-square w-full rounded-lg border border-slate-200 object-cover"
                              src={receipt.url}
                            />
                          </a>
                        ),
                      )}
                    </div>
                    {sale.receipts.some(
                      (receipt) => receipt.mimeType === 'application/pdf',
                    ) && (
                      <p className="mt-2 text-xs text-slate-600">
                        As páginas dos comprovantes em PDF serão anexadas ao
                        final deste relatório.
                      </p>
                    )}
                  </section>
                )}
                {level === 'complete' && (
                  <section className="report-section mt-5 rounded-xl bg-slate-100 p-3 text-sm">
                    <p>
                      <strong>Vendedor:</strong> {sale.sellerName}
                    </p>
                    <p>
                      <strong>Status do pedido:</strong>{' '}
                      {sale.orderStatus?.name ?? 'Sem status'}
                    </p>
                    <p>
                      <strong>Total cadastrado:</strong>{' '}
                      {formatMoney(sale.referenceTotalCents)}
                    </p>
                    <p>
                      <strong>Total dos produtos:</strong>{' '}
                      {formatMoney(sale.productsTotalCents)}
                    </p>
                    <p>
                      <strong>Total recebido:</strong>{' '}
                      {formatMoney(sale.receivedTotalCents)}
                    </p>
                    {sale.status === 'cancelled' && (
                      <p>
                        <strong>Cancelamento:</strong> {sale.cancellationReason}{' '}
                        ·{' '}
                        {sale.cancelledAt
                          ? formatDateTime(sale.cancelledAt)
                          : ''}
                      </p>
                    )}
                  </section>
                )}
              </article>
            </div>
            <DialogFooter
              className="shrink-0 border-t bg-background p-3"
              data-report-controls
            >
              {pdfError && (
                <p className="mr-auto text-left text-sm font-semibold text-destructive">
                  {pdfError}
                </p>
              )}
              <Button onClick={() => onOpenChange(false)} variant="outline">
                Fechar
              </Button>
              <Button
                disabled={pdfBusy}
                onClick={async () => {
                  if (!reportRef.current) return;
                  setPdfBusy(true);
                  setPdfError('');
                  try {
                    await downloadReportPdf({
                      element: reportRef.current,
                      fileName: `venda-${String(sale.number).padStart(5, '0')}-${dateKey(sale.createdAt)}`,
                      pdfAttachments: includeReceipts
                        ? sale.receipts
                            .filter(
                              (receipt) =>
                                receipt.mimeType === 'application/pdf',
                            )
                            .map((receipt) => ({
                              name: receipt.name,
                              url: receipt.url,
                            }))
                        : [],
                    });
                  } catch (error) {
                    setPdfError(messageOf(error));
                  } finally {
                    setPdfBusy(false);
                  }
                }}
              >
                {pdfBusy ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Download />
                )}
                {pdfBusy ? 'Gerando PDF…' : 'Baixar PDF'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  sale,
  data,
  onOpenChange,
  onChanged,
}: {
  sale: SaleRecord | null;
  data: BootstrapData;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setReason('');
          setError('');
        }
        onOpenChange(open);
      }}
      open={Boolean(sale)}
    >
      <DialogContent className="max-w-md">
        {sale && (
          <>
            <DialogHeader>
              <DialogTitle>
                Cancelar venda #{String(sale.number).padStart(5, '0')}
              </DialogTitle>
              <DialogDescription>
                O histórico, fotos e comprovantes serão preservados. Os SNs
                voltarão ao estoque disponível.
              </DialogDescription>
            </DialogHeader>
            <label className="text-sm font-semibold">
              Motivo
              <Textarea
                className="mt-1"
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explique o cancelamento"
                value={reason}
              />
            </label>
            {error && (
              <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)} variant="outline">
                Voltar
              </Button>
              <Button
                disabled={busy || reason.trim().length < 5}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await requestJson(`/api/sales/${sale.id}/cancel`, {
                      method: 'POST',
                      headers: {
                        'content-type': 'application/json',
                        'x-csrf-token': data.csrfToken,
                      },
                      body: JSON.stringify({ reason }),
                    });
                    await onChanged();
                    onOpenChange(false);
                    setReason('');
                  } catch (caught) {
                    setError(messageOf(caught));
                  } finally {
                    setBusy(false);
                  }
                }}
                variant="destructive"
              >
                Confirmar cancelamento
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Empty({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="grid h-full min-h-52 place-items-center p-6 text-center">
      <div>
        <WalletCards className="mx-auto size-9 text-muted-foreground" />
        <p className="mt-3 font-bold">
          {hasAny ? 'Nenhuma venda encontrada' : 'Nenhuma venda registrada'}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasAny
            ? 'Ajuste os filtros.'
            : 'As vendas confirmadas aparecerão aqui.'}
        </p>
      </div>
    </div>
  );
}
function WarningBadge({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/12 px-1.5 py-1 text-[.68rem] font-bold text-amber-900">
      <AlertTriangle className="size-3" />
      {text}
    </span>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="p-2.5 sm:p-3">
        <p className="truncate text-[.62rem] font-bold uppercase text-muted-foreground sm:text-xs">
          {label}
        </p>
        <p className="mt-0.5 truncate text-sm font-extrabold sm:text-lg">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-100 p-3">
      <dt className="truncate text-[.65rem] font-bold uppercase text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-extrabold sm:text-lg">
        {value}
      </dd>
    </div>
  );
}
function groupModels(sale: SaleRecord | null) {
  const groups = new Map<
    string,
    { key: string; name: string; detail: string; items: SaleRecord['items'] }
  >();
  sale?.items.forEach((item) => {
    const key = `${item.productName}\u0000${item.productDetail}`;
    const group = groups.get(key) ?? {
      key,
      name: item.productName,
      detail: item.productDetail,
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  });
  return Array.from(groups.values());
}
function paymentLabel(sale: SaleRecord) {
  return sale.payments
    .map((payment) =>
      payment.method === 'pix'
        ? `Pix${payment.accountName ? ` · ${payment.accountName}` : ''}`
        : 'Dinheiro',
    )
    .join(' + ');
}
function reportName(level: ReportLevel) {
  return level === 'simple'
    ? 'simplificado'
    : level === 'detailed'
      ? 'detalhado'
      : 'completo';
}
function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}

function formatMoneyInput(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
function dateKey(value: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}
function formatDateTime(value: number) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
