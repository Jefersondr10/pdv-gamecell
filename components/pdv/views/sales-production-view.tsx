'use client';

/* oxlint-disable next/no-img-element, jsx-a11y/label-has-associated-control -- report media is authenticated and the custom textarea is wrapped by its label */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  CircleAlert,
  Download,
  FileCheck2,
  FileText,
  ImagePlus,
  ListFilter,
  LoaderCircle,
  Paperclip,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  SlidersHorizontal,
  Smartphone,
  Trophy,
  UserRound,
  UsersRound,
  WalletCards,
  XCircle,
} from 'lucide-react';

import { OrderStatusBadge } from '@/components/pdv/order-status-badge';
import {
  ReceiptReconciliationEditor,
  ReconciliationSummary,
  SavedReceiptValueEditor,
} from '@/components/pdv/receipt-reconciliation-editor';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { messageOf, requestJson } from '@/lib/client-api';
import {
  formatMediaBytes,
  MEDIA_LIMITS,
  prepareMediaSelection,
} from '@/lib/client-media';
import { createOperationId } from '@/lib/client-operation-id';
import {
  enqueueReceiptOcrJobs,
  type ReceiptOcrAttachment,
} from '@/lib/client-receipt-background';
import { downloadReportPdf } from '@/lib/download-report-pdf';
import { parseMoneyInput } from '@/lib/money';
import {
  deriveReceiptReconciliation,
  type ReceiptValueInput,
} from '@/lib/receipt-reconciliation';
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
type IssueFilter = 'all' | 'missing_receipt' | 'pending_payment';
type SelectedGroup = {
  dimension: SalesGrouping;
  row: SalesGroupRecord;
};
type QueuedPayment = {
  operationId: string;
  method: 'pix' | 'cash';
  pixAccountId: string | null;
  accountName: string | null;
  amountCents: number;
};
type FilterOption<T extends string> = {
  detail?: string;
  label: string;
  value: T;
};

const PERIOD_OPTIONS: Array<FilterOption<PeriodFilter>> = [
  { detail: 'Vendas realizadas hoje', label: 'Hoje', value: 'today' },
  { detail: 'Vendas do dia anterior', label: 'Ontem', value: 'yesterday' },
  { detail: 'Últimos sete dias', label: 'Semana', value: '7d' },
  { detail: 'Últimos quinze dias', label: '15 dias', value: '15d' },
  { detail: 'Selecione uma data', label: 'Escolher dia', value: 'day' },
  { detail: 'Selecione um mês', label: 'Mês escolhido', value: 'month' },
  { detail: 'Histórico completo', label: 'Todo período', value: 'all' },
];
const ISSUE_OPTIONS: Array<FilterOption<IssueFilter>> = [
  {
    detail: 'Exibe vendas com ou sem aviso',
    label: 'Todas as pendências',
    value: 'all',
  },
  {
    detail: 'Venda ainda sem arquivo anexado',
    label: 'Sem comprovante',
    value: 'missing_receipt',
  },
  {
    detail: 'Ainda existe valor a receber',
    label: 'Pagamento pendente',
    value: 'pending_payment',
  },
];
const ANALYTICS_CACHE_MS = 5 * 60 * 1000;
const PERIOD_REPORT_SALES_LIMIT = 250;
const PERIOD_REPORT_MEDIA_LIMIT = 40;
const PERIOD_REPORT_MEDIA_BYTES_LIMIT = 25 * 1024 * 1024;

function emptySalesPage(): SalesPage {
  return {
    items: [],
    groups: [],
    nextCursor: null,
    total: 0,
    aggregates: {
      amountCents: 0,
      saleCount: 0,
      itemCount: 0,
      alertCount: 0,
    },
    comparison: null,
  };
}

export function SalesProductionView({
  data,
  onChanged,
  openSaleId = null,
  onOpenSaleHandled,
}: {
  data: BootstrapData;
  onChanged: () => Promise<void>;
  openSaleId?: string | null;
  onOpenSaleHandled?: () => void;
}) {
  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<PeriodFilter>(() =>
    openSaleId ? 'all' : 'today',
  );
  const [selectedDay, setSelectedDay] = useState(() => dateKey(Date.now()));
  const [selectedMonth, setSelectedMonth] = useState(() =>
    dateKey(Date.now()).slice(0, 7),
  );
  const [grouping, setGrouping] = useState<Grouping>('sale');
  const [alertOnly, setAlertOnly] = useState(false);
  const [issueFilter, setIssueFilter] = useState<IssueFilter>('all');
  const [orderStatusFilter, setOrderStatusFilter] = useState('all');
  const [sellerRanking, setSellerRanking] = useState<SellerRanking>('items');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [periodReportOpen, setPeriodReportOpen] = useState(false);
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
  const [targetNotice, setTargetNotice] = useState('');
  const listRequestIdRef = useRef(0);
  const analyticsRequestIdRef = useRef(0);
  const listDataKeyRef = useRef('');
  const listPendingKeyRef = useRef('');
  const analyticsPendingKeyRef = useRef('');
  const openedTargetRef = useRef('');
  const analyticsCacheRef = useRef(
    new Map<string, { loadedAt: number; value: SalesAnalytics }>(),
  );
  const canCancel = data.user.role === 'owner' || data.user.role === 'admin';
  const filterParams = useMemo(() => {
    const params = new URLSearchParams({ period });
    if (period === 'day') params.set('day', selectedDay);
    if (period === 'month') params.set('month', selectedMonth);
    if (query) params.set('q', query);
    if (alertOnly) params.set('alert', '1');
    if (issueFilter !== 'all') params.set('issue', issueFilter);
    if (orderStatusFilter !== 'all') {
      params.set('orderStatus', orderStatusFilter);
    }
    if (openSaleId) params.set('saleId', openSaleId);
    return params.toString();
  }, [
    alertOnly,
    issueFilter,
    openSaleId,
    orderStatusFilter,
    period,
    query,
    selectedDay,
    selectedMonth,
  ]);
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
    const refreshSales = () => {
      analyticsCacheRef.current.clear();
      listDataKeyRef.current = '';
      setAnalyticsState(null);
      if (grouping === 'sale') void loadSales(null, false, true);
      else void loadAnalytics(true);
    };
    window.addEventListener('pdv:sales-changed', refreshSales);
    return () => window.removeEventListener('pdv:sales-changed', refreshSales);
  }, [grouping, loadAnalytics, loadSales]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (grouping === 'sale') void loadSales();
      else void loadAnalytics();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [grouping, loadAnalytics, loadSales]);

  useEffect(() => {
    if (!openSaleId || openedTargetRef.current === openSaleId) return;
    if (listLoading || listError || listDataKeyRef.current !== filterKey) {
      return;
    }
    const timer = window.setTimeout(() => {
      const target = page.items.find((sale) => sale.id === openSaleId);
      if (target) {
        openedTargetRef.current = openSaleId;
        setTargetNotice('');
        setReportSale(target);
      } else {
        setTargetNotice(
          'A venda vinculada a este SN não foi encontrada. Todas as vendas foram exibidas.',
        );
      }
      onOpenSaleHandled?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    filterKey,
    listError,
    listLoading,
    onOpenSaleHandled,
    openSaleId,
    page.items,
  ]);

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
  const activeComparison =
    grouping === 'sale' ? page.comparison : (analytics?.comparison ?? null);
  const activeLoading = grouping === 'sale' ? listLoading : analyticsLoading;
  const activeError =
    grouping === 'sale'
      ? page.items.length === 0
        ? listError
        : ''
      : analyticsError;
  const reportFilterSummary = useMemo(() => {
    const pieces = [periodDescription(period, selectedDay, selectedMonth)];
    if (query) pieces.push(`Busca: ${query}`);
    if (alertOnly) pieces.push('Somente vendas com avisos');
    if (issueFilter === 'missing_receipt') pieces.push('Sem comprovante');
    if (issueFilter === 'pending_payment') pieces.push('Pagamento pendente');
    if (orderStatusFilter === 'none') pieces.push('Sem status de pedido');
    else if (orderStatusFilter !== 'all') {
      const status = data.orderStatuses.find(
        (candidate) => candidate.id === orderStatusFilter,
      );
      if (status) pieces.push(`Status: ${status.name}`);
    }
    return pieces.join(' · ');
  }, [
    alertOnly,
    data.orderStatuses,
    issueFilter,
    orderStatusFilter,
    period,
    query,
    selectedDay,
    selectedMonth,
  ]);
  const activeCount =
    grouping === 'sale' ? page.items.length : groupRows.length;
  const activeTotal =
    grouping === 'sale' ? page.total : (analytics?.total ?? 0);
  const additionalFilterCount =
    Number(issueFilter !== 'all') + Number(orderStatusFilter !== 'all');

  const reloadActive = async () => {
    if (grouping === 'sale') await loadSales(null, false, true);
    else await loadAnalytics(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-2 py-2 sm:px-6 sm:py-5 lg:px-10">
      <div className="mb-2 flex shrink-0 items-end justify-between gap-3 sm:mb-3">
        <div className="min-w-0">
          <p className="eyebrow hidden sm:block">Comercial</p>
          <h1 className="text-xl font-black tracking-[-.04em] sm:mt-0.5 sm:text-3xl">
            Vendas
          </h1>
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
            Filtre o período, veja por venda, modelo, cliente ou vendedor e abra
            os SNs de cada grupo.
          </p>
        </div>
        <Button
          className="h-9 rounded-xl bg-gradient-to-r from-blue-700 to-cyan-600 px-3 font-extrabold text-white shadow-sm hover:from-blue-800 hover:to-cyan-700"
          onClick={() => setPeriodReportOpen(true)}
          type="button"
        >
          <Download />
          <span className="sm:hidden">Relatório</span>
          <span className="hidden sm:inline">Relatório de vendas</span>
        </Button>
      </div>
      <div className="mb-2 grid shrink-0 grid-cols-4 gap-1 sm:mb-3 sm:grid-cols-2 sm:gap-2 lg:grid-cols-4">
        <Metric
          active={grouping === 'sale' && !alertOnly}
          comparison={
            activeComparison
              ? {
                  current: activeAggregates.saleCount,
                  label: activeComparison.label,
                  previous: activeComparison.aggregates.saleCount,
                  previousDisplay: String(
                    activeComparison.aggregates.saleCount,
                  ),
                }
              : null
          }
          label="Vendas concluídas"
          mobileLabel="Vendas"
          onClick={() => {
            setAlertOnly(false);
            setIssueFilter('all');
            setOrderStatusFilter('all');
            setGrouping('sale');
          }}
          tone="blue"
          value={String(activeAggregates.saleCount)}
        />
        <Metric
          active={grouping === 'sale' && !alertOnly}
          comparison={
            activeComparison
              ? {
                  current: activeAggregates.amountCents,
                  label: activeComparison.label,
                  previous: activeComparison.aggregates.amountCents,
                  previousDisplay: formatMoney(
                    activeComparison.aggregates.amountCents,
                  ),
                }
              : null
          }
          label="Montante vendido"
          mobileLabel="Valor"
          mobileValue={formatCompactMoney(activeAggregates.amountCents)}
          onClick={() => {
            setAlertOnly(false);
            setIssueFilter('all');
            setOrderStatusFilter('all');
            setGrouping('sale');
          }}
          tone="emerald"
          value={formatMoney(activeAggregates.amountCents)}
        />
        <Metric
          active={grouping === 'model' && !alertOnly}
          comparison={
            activeComparison
              ? {
                  current: activeAggregates.itemCount,
                  label: activeComparison.label,
                  previous: activeComparison.aggregates.itemCount,
                  previousDisplay: String(
                    activeComparison.aggregates.itemCount,
                  ),
                }
              : null
          }
          label="Aparelhos"
          mobileLabel="Aparelhos"
          onClick={() => {
            setAlertOnly(false);
            setIssueFilter('all');
            setGrouping('model');
          }}
          tone="violet"
          value={String(activeAggregates.itemCount)}
        />
        <Metric
          active={alertOnly}
          comparison={
            activeComparison
              ? {
                  current: activeAggregates.alertCount,
                  inverse: true,
                  label: activeComparison.label,
                  previous: activeComparison.aggregates.alertCount,
                  previousDisplay: String(
                    activeComparison.aggregates.alertCount,
                  ),
                }
              : null
          }
          label="Avisos"
          mobileLabel="Avisos"
          onClick={() => {
            setAlertOnly(true);
            setIssueFilter('all');
            setOrderStatusFilter('all');
            setGrouping('sale');
          }}
          tone="amber"
          value={String(activeAggregates.alertCount)}
        />
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 space-y-2 border-b bg-gradient-to-r from-slate-50/80 via-background to-blue-50/60 p-2 dark:from-slate-950/40 dark:to-blue-950/20 sm:p-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 md:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_13rem_14rem_14rem]">
            <label className="col-span-2 min-w-0 md:col-span-1">
              <span className="mb-1 flex items-center gap-1.5 px-1 text-[.64rem] font-black uppercase tracking-[.12em] text-slate-600 dark:text-slate-300">
                <Search className="size-3 text-blue-600" /> Pesquisar vendas
              </span>
              <span className="relative block">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-blue-600" />
                <Input
                  className="h-11 rounded-xl border-blue-200/80 bg-background pl-9 font-bold tracking-[-.01em] shadow-sm placeholder:font-medium dark:border-blue-900/70"
                  onChange={(event) => setQueryDraft(event.target.value)}
                  placeholder="Cliente, vendedor, modelo, venda ou SN"
                  value={queryDraft}
                />
              </span>
            </label>
            <div className="min-w-0">
              <span className="mb-1 flex items-center gap-1.5 px-1 text-[.64rem] font-black uppercase tracking-[.12em] text-slate-600 dark:text-slate-300">
                <CalendarDays className="size-3 text-emerald-600" /> Período
              </span>
              <SalesFilterSelect
                aria-label="Período das vendas"
                onValueChange={setPeriod}
                options={PERIOD_OPTIONS}
                tone="emerald"
                value={period}
              />
            </div>
            <Button
              aria-expanded={mobileFiltersOpen}
              className="mt-[1.05rem] h-11 rounded-xl border-violet-200 bg-violet-50 px-3 font-extrabold text-violet-900 shadow-sm hover:bg-violet-100 md:hidden dark:border-violet-900/70 dark:bg-violet-950/30 dark:text-violet-100"
              onClick={() => setMobileFiltersOpen((current) => !current)}
              type="button"
              variant="outline"
            >
              <SlidersHorizontal />
              {mobileFiltersOpen
                ? 'Ocultar'
                : `Filtros${additionalFilterCount ? ` (${additionalFilterCount})` : ''}`}
            </Button>
            <div
              className={cn(
                'col-span-2 grid-cols-2 gap-2 md:contents',
                mobileFiltersOpen ? 'grid' : 'hidden',
              )}
            >
              <div className="min-w-0">
                <span className="mb-1 flex items-center gap-1.5 px-1 text-[.64rem] font-black uppercase tracking-[.12em] text-slate-600 dark:text-slate-300">
                  <CircleAlert className="size-3 text-amber-600" /> Pendência
                </span>
                <SalesFilterSelect
                  aria-label="Pendência da venda"
                  onValueChange={(next) => {
                    setIssueFilter(next);
                    if (next !== 'all') {
                      setAlertOnly(false);
                      setGrouping('sale');
                    }
                  }}
                  options={ISSUE_OPTIONS}
                  tone="amber"
                  value={issueFilter}
                />
              </div>
              <div className="min-w-0">
                <span className="mb-1 flex items-center gap-1.5 px-1 text-[.64rem] font-black uppercase tracking-[.12em] text-slate-600 dark:text-slate-300">
                  <ListFilter className="size-3 text-fuchsia-600" /> Status
                </span>
                <SalesFilterSelect
                  aria-label="Status do pedido"
                  onValueChange={setOrderStatusFilter}
                  options={[
                    {
                      detail: 'Exibe qualquer acompanhamento',
                      label: 'Todos os status',
                      value: 'all',
                    },
                    {
                      detail: 'Pedidos ainda sem classificação',
                      label: 'Sem status',
                      value: 'none',
                    },
                    ...data.orderStatuses.map((status) => ({
                      detail: status.active
                        ? 'Status cadastrado pela loja'
                        : 'Status inativo',
                      label: `${status.name}${status.active ? '' : ' (inativo)'}`,
                      value: status.id,
                    })),
                  ]}
                  tone="fuchsia"
                  value={orderStatusFilter}
                />
              </div>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-[auto_1fr]">
            {(period === 'day' || period === 'month') && (
              <Input
                aria-label={
                  period === 'day' ? 'Dia das vendas' : 'Mês das vendas'
                }
                className="h-9 rounded-xl border-emerald-200 bg-emerald-50/70 font-bold md:w-44 dark:border-emerald-900/70 dark:bg-emerald-950/20"
                onChange={(event) => {
                  if (!event.target.value) return;
                  if (period === 'day') setSelectedDay(event.target.value);
                  else setSelectedMonth(event.target.value);
                }}
                type={period === 'day' ? 'date' : 'month'}
                value={period === 'day' ? selectedDay : selectedMonth}
              />
            )}
            <div className="grid grid-cols-4 gap-1 rounded-2xl bg-slate-200/65 p-1 dark:bg-slate-900/70 md:ml-auto md:w-[36rem]">
              {(
                [
                  [
                    'sale',
                    'Por venda',
                    'Venda',
                    ReceiptText,
                    'bg-gradient-to-br from-blue-600 to-blue-800 text-white shadow-md shadow-blue-600/20',
                    'text-blue-800 hover:bg-blue-100/80 dark:text-blue-200 dark:hover:bg-blue-950/60',
                  ],
                  [
                    'model',
                    'Por modelo',
                    'Modelo',
                    Smartphone,
                    'bg-gradient-to-br from-violet-600 to-violet-800 text-white shadow-md shadow-violet-600/20',
                    'text-violet-800 hover:bg-violet-100/80 dark:text-violet-200 dark:hover:bg-violet-950/60',
                  ],
                  [
                    'customer',
                    'Por cliente',
                    'Cliente',
                    UsersRound,
                    'bg-gradient-to-br from-emerald-600 to-emerald-800 text-white shadow-md shadow-emerald-600/20',
                    'text-emerald-800 hover:bg-emerald-100/80 dark:text-emerald-200 dark:hover:bg-emerald-950/60',
                  ],
                  [
                    'seller',
                    'Ranking',
                    'Ranking',
                    Trophy,
                    'bg-gradient-to-br from-amber-400 to-orange-500 text-slate-950 shadow-md shadow-amber-500/20',
                    'text-amber-800 hover:bg-amber-100/80 dark:text-amber-200 dark:hover:bg-amber-950/60',
                  ],
                ] as const
              ).map(
                ([
                  value,
                  label,
                  mobileLabel,
                  Icon,
                  activeClass,
                  inactiveClass,
                ]) => {
                  const selected = grouping === value;
                  return (
                    <Button
                      aria-pressed={selected}
                      className={cn(
                        'h-9 gap-1 rounded-xl px-1 text-[.68rem] font-black uppercase tracking-[.035em] shadow-none transition-all sm:px-3 sm:text-xs',
                        selected ? activeClass : inactiveClass,
                      )}
                      key={value}
                      onClick={() => {
                        setGrouping(value);
                        if (value !== 'sale') setAlertOnly(false);
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      <Icon className="size-3.5 shrink-0" />
                      <span className="sm:hidden">{mobileLabel}</span>
                      <span className="hidden sm:inline">{label}</span>
                    </Button>
                  );
                },
              )}
            </div>
          </div>
          {grouping === 'seller' && (
            <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
              <span className="mr-auto flex items-center gap-1 font-extrabold sm:mr-0">
                <Trophy className="size-3.5 text-amber-500" /> Ordenar ranking
              </span>
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
          {targetNotice && (
            <button
              className="rounded-lg bg-amber-500/10 px-3 py-2 text-left text-xs font-semibold text-amber-950 dark:text-amber-100"
              onClick={() => setTargetNotice('')}
              type="button"
            >
              {targetNotice} Toque para fechar.
            </button>
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
              hasAny={
                Boolean(query) ||
                period !== 'all' ||
                alertOnly ||
                issueFilter !== 'all' ||
                orderStatusFilter !== 'all' ||
                Boolean(openSaleId) ||
                activeTotal > 0
              }
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
      <SalesPeriodReport
        filterParams={filterParams}
        filterSummary={reportFilterSummary}
        onOpenChange={setPeriodReportOpen}
        open={periodReportOpen}
        period={period}
        storeName={data.store.name}
      />
      <EditSaleDialog
        data={data}
        key={editSale?.id ?? 'closed-sale-editor'}
        onChanged={async () => {
          analyticsCacheRef.current.clear();
          listDataKeyRef.current = '';
          setAnalyticsState(null);
          await loadSales(null, false, true);
          void onChanged();
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
              ? 'bg-muted/35 px-3 py-2 opacity-75 sm:px-5 sm:py-3'
              : 'px-3 py-2 sm:px-5 sm:py-3'
          }
          key={sale.id}
        >
          <div className="grid gap-1.5 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-3">
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
                {sale.status === 'completed' &&
                  sale.receivedDifferenceCents !== 0 && (
                    <WarningBadge
                      text={paymentDifferenceText(sale)!}
                      tone={
                        sale.receivedDifferenceCents < 0
                          ? 'payment'
                          : 'overpayment'
                      }
                    />
                  )}
                {sale.status === 'completed' && sale.receipts.length === 0 && (
                  <WarningBadge text="Sem comprovante" tone="receipt" />
                )}
                {sale.status === 'completed' &&
                  sale.receipts.length > 0 &&
                  sale.reconciliation.status === 'reconciled' && (
                    <SuccessBadge text="Conciliado" />
                  )}
                {sale.status === 'completed' &&
                  sale.receipts.length > 0 &&
                  sale.reconciliation.status === 'pending' && (
                    <WarningBadge
                      text={
                        sale.productsTotalCents <= 0
                          ? 'Venda sem valor definido'
                          : 'Conferir comprovante'
                      }
                      tone={
                        sale.productsTotalCents <= 0
                          ? 'information'
                          : 'processing'
                      }
                    />
                  )}
                {sale.status === 'completed' &&
                  sale.reconciliation.status === 'divergent' && (
                    <WarningBadge
                      text={`Verificar venda · ${(sale.reconciliation.differenceCents ?? 0) < 0 ? 'falta' : 'sobra'} ${formatMoney(Math.abs(sale.reconciliation.differenceCents ?? 0))}`}
                      tone="reconciliation"
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
              <dl className="mr-2 grid min-w-[12rem] grid-cols-2 gap-x-3 text-right">
                <div>
                  <dt className="text-[.6rem] font-bold uppercase text-muted-foreground">
                    Valor da venda
                  </dt>
                  <dd className="text-sm font-extrabold">
                    {formatMoney(sale.productsTotalCents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[.6rem] font-bold uppercase text-muted-foreground">
                    Total pago
                  </dt>
                  <dd className="text-sm font-extrabold">
                    {formatMoney(sale.receivedTotalCents)}
                  </dd>
                </div>
              </dl>
              <Button
                className="h-8 border-blue-200 bg-blue-50 px-2 font-extrabold text-blue-900 hover:bg-blue-100 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-100"
                onClick={() => onReport(sale)}
                size="sm"
                variant="outline"
              >
                <FileText /> PDF
              </Button>
              {sale.status === 'completed' && (
                <Button
                  className="h-8 px-2"
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
  const [receiptValues, setReceiptValues] = useState<ReceiptValueInput[]>([]);
  const [savedReceiptValues, setSavedReceiptValues] = useState<
    Record<string, ReceiptValueInput>
  >(() =>
    Object.fromEntries(
      (sale?.receipts ?? []).map((receipt) => [
        receipt.id,
        {
          amountCents: receipt.receiptAmountCents,
          source: receipt.receiptAmountSource,
        },
      ]),
    ),
  );
  const receiptValueOperationIdRef = useRef(createOperationId());
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
  const [queuedPayments, setQueuedPayments] = useState<QueuedPayment[]>([]);
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
  const queuedPaymentCents = queuedPayments.reduce(
    (total, payment) => total + payment.amountCents,
    0,
  );
  const remainingPaymentCents = Math.max(
    0,
    pendingPaymentCents - queuedPaymentCents,
  );
  const paymentReady =
    paymentMethod !== '' &&
    additionalPaymentCents > 0 &&
    additionalPaymentCents <= remainingPaymentCents &&
    (paymentMethod !== 'pix' || Boolean(paymentPixAccountId));
  const changedSavedReceiptValues = (sale?.receipts ?? []).flatMap(
    (receipt) => {
      const value = savedReceiptValues[receipt.id] ?? {
        amountCents: null,
        source: null,
      };
      return value.amountCents !== receipt.receiptAmountCents ||
        value.source !== receipt.receiptAmountSource
        ? [{ id: receipt.id, ...value }]
        : [];
    },
  );
  const reconciliation = sale
    ? deriveReceiptReconciliation(
        [
          ...sale.receipts.map(
            (receipt) =>
              savedReceiptValues[receipt.id] ?? {
                amountCents: receipt.receiptAmountCents,
                source: receipt.receiptAmountSource,
              },
          ),
          ...receiptValues,
        ],
        sale.productsTotalCents,
      )
    : null;

  const currentPaymentDraft = (): QueuedPayment | null => {
    if (!paymentReady || !paymentMethod) return null;
    return {
      operationId: paymentOperationIdRef.current,
      method: paymentMethod,
      pixAccountId: paymentMethod === 'pix' ? paymentPixAccountId : null,
      accountName:
        paymentMethod === 'pix'
          ? (activePixAccounts.find(
              (account) => account.id === paymentPixAccountId,
            )?.name ?? null)
          : null,
      amountCents: additionalPaymentCents,
    };
  };

  const queueCurrentPayment = () => {
    const draft = currentPaymentDraft();
    if (!draft) return;
    setQueuedPayments((current) => [...current, draft]);
    const nextRemaining = Math.max(
      0,
      remainingPaymentCents - draft.amountCents,
    );
    setPaymentMethod('');
    setPaymentAmount(formatMoneyInput(nextRemaining));
    paymentOperationIdRef.current = createOperationId();
  };

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
      setReceiptValues((current) =>
        result.files.map(
          (_, index) => current[index] ?? { amountCents: null, source: null },
        ),
      );
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

                  {(visiblePayments.length > 0 ||
                    queuedPayments.length > 0) && (
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
                      {queuedPayments.map((payment) => (
                        <div
                          className="flex items-center justify-between gap-3 rounded-lg bg-primary/5 px-2 py-1.5"
                          key={payment.operationId}
                        >
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {payment.method === 'pix'
                              ? `Pix${payment.accountName ? ` · ${payment.accountName}` : ''}`
                              : 'Dinheiro'}{' '}
                            · novo
                          </span>
                          <strong>{formatMoney(payment.amountCents)}</strong>
                          <Button
                            aria-label="Remover novo pagamento"
                            className="size-7"
                            onClick={() => {
                              setQueuedPayments((current) =>
                                current.filter(
                                  (candidate) =>
                                    candidate.operationId !==
                                    payment.operationId,
                                ),
                              );
                            }}
                            size="icon"
                            type="button"
                            variant="ghost"
                          >
                            <XCircle />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {remainingPaymentCents > 0 && (
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
                  )}

                  {remainingPaymentCents > 0 && paymentMethod === 'pix' && (
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

                  {remainingPaymentCents > 0 &&
                    paymentMethod &&
                    !paymentReady && (
                      <p
                        aria-live="polite"
                        className="mt-2 text-xs font-semibold text-destructive"
                        id={`sale-${sale.id}-payment-error`}
                      >
                        Informe um valor entre R$ 0,01 e{' '}
                        {formatMoney(remainingPaymentCents)}
                        {paymentMethod === 'pix' && !paymentPixAccountId
                          ? ' e selecione uma conta Pix.'
                          : '.'}
                      </p>
                    )}
                  {remainingPaymentCents > 0 && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-muted-foreground">
                        Ainda falta distribuir{' '}
                        {formatMoney(remainingPaymentCents)}.
                      </p>
                      <Button
                        disabled={!paymentReady}
                        onClick={queueCurrentPayment}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Plus /> Adicionar pagamento
                      </Button>
                    </div>
                  )}
                  {queuedPayments.length > 0 && remainingPaymentCents === 0 && (
                    <p className="mt-3 rounded-xl bg-success/10 px-3 py-2 text-xs font-semibold text-success">
                      O saldo foi distribuído entre {queuedPayments.length}{' '}
                      {queuedPayments.length === 1 ? 'pagamento' : 'pagamentos'}
                      .
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
                  <div className="mt-3 space-y-2">
                    {sale.receipts.map((receipt) => (
                      <SavedReceiptValueEditor
                        disabled={preparing || uploadBusy}
                        key={receipt.id}
                        onAutoValueFound={async (value) => {
                          await requestJson(
                            `/api/sales/${sale.id}/receipt-values`,
                            {
                              method: 'PATCH',
                              headers: {
                                'content-type': 'application/json',
                                'x-csrf-token': data.csrfToken,
                              },
                              body: JSON.stringify({
                                onlyIfPending: true,
                                operationId: createOperationId(),
                                receipts: [{ id: receipt.id, ...value }],
                              }),
                            },
                          );
                          await onChanged();
                        }}
                        onValueChange={(value) =>
                          setSavedReceiptValues((current) => ({
                            ...current,
                            [receipt.id]: value,
                          }))
                        }
                        receipt={receipt}
                        value={
                          savedReceiptValues[receipt.id] ?? {
                            amountCents: receipt.receiptAmountCents,
                            source: receipt.receiptAmountSource,
                          }
                        }
                      />
                    ))}
                  </div>
                )}
                {receiptFiles.length > 0 && (
                  <>
                    <SelectedFiles
                      files={receiptFiles}
                      onClear={() => {
                        setReceiptFiles([]);
                        setReceiptValues([]);
                      }}
                    />
                    <ReceiptReconciliationEditor
                      className="mt-3"
                      disabled={preparing || uploadBusy}
                      files={receiptFiles}
                      onValueChange={(index, value) =>
                        setReceiptValues((current) =>
                          receiptFiles.map((_, candidateIndex) =>
                            candidateIndex === index
                              ? value
                              : (current[candidateIndex] ?? {
                                  amountCents: null,
                                  source: null,
                                }),
                          ),
                        )
                      }
                      showSummary={false}
                      targetCents={sale.productsTotalCents}
                      values={receiptValues}
                    />
                  </>
                )}
                {reconciliation && (
                  <ReconciliationSummary
                    className="mt-3"
                    reconciliation={reconciliation}
                    targetCents={sale.productsTotalCents}
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
                      changedSavedReceiptValues.length === 0 &&
                      queuedPayments.length === 0 &&
                      paymentMethod === '')
                  }
                  onClick={async () => {
                    setUploadBusy(true);
                    setError('');
                    setNotice('');
                    let statusSaved = false;
                    let paymentSaved = false;
                    let receiptValuesSaved = false;
                    let attachmentsSaved = false;
                    try {
                      const inlinePayment = currentPaymentDraft();
                      const paymentsToSave = [
                        ...queuedPayments,
                        ...(inlinePayment ? [inlinePayment] : []),
                      ];
                      let latestPending = pendingPaymentCents;
                      for (const paymentDraft of paymentsToSave) {
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
                            operationId: paymentDraft.operationId,
                            method: paymentDraft.method,
                            pixAccountId: paymentDraft.pixAccountId,
                            amountCents: paymentDraft.amountCents,
                          }),
                        });
                        paymentSaved = true;
                        latestPending = Math.max(
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
                        setQueuedPayments((current) =>
                          current.filter(
                            (candidate) =>
                              candidate.operationId !==
                              paymentDraft.operationId,
                          ),
                        );
                        setPendingPaymentCents(latestPending);
                        setPaymentAmount(formatMoneyInput(latestPending));
                      }
                      if (paymentsToSave.length > 0) {
                        setPendingPaymentCents(latestPending);
                        setPaymentAmount(formatMoneyInput(latestPending));
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
                      if (changedSavedReceiptValues.length > 0) {
                        await requestJson(
                          `/api/sales/${sale.id}/receipt-values`,
                          {
                            method: 'PATCH',
                            headers: {
                              'content-type': 'application/json',
                              'x-csrf-token': data.csrfToken,
                            },
                            body: JSON.stringify({
                              operationId: receiptValueOperationIdRef.current,
                              receipts: changedSavedReceiptValues,
                            }),
                          },
                        );
                        receiptValuesSaved = true;
                      }
                      if (selectedFiles.length > 0) {
                        const form = new FormData();
                        receiptFiles.forEach((file) =>
                          form.append('receipts', file),
                        );
                        if (receiptFiles.length > 0) {
                          form.append(
                            'receiptValues',
                            JSON.stringify(receiptValues),
                          );
                        }
                        Object.entries(itemFiles).forEach(([itemId, files]) => {
                          files.forEach((file) =>
                            form.append(`itemPhotos:${itemId}`, file),
                          );
                        });
                        const attachmentResult = await requestJson<{
                          receipts: ReceiptOcrAttachment[];
                        }>(`/api/sales/${sale.id}/attachments`, {
                          method: 'POST',
                          headers: { 'x-csrf-token': data.csrfToken },
                          body: form,
                        });
                        void enqueueReceiptOcrJobs({
                          attachments: attachmentResult.receipts ?? [],
                          files: receiptFiles,
                          receiptValues,
                          saleId: sale.id,
                          storeId: data.store.id,
                        }).catch(() => {});
                        attachmentsSaved = true;
                      }
                      await onChanged();
                      onOpenChange(false);
                    } catch (caught) {
                      const savedParts = [
                        paymentSaved ? 'o pagamento' : '',
                        statusSaved ? 'o status' : '',
                        receiptValuesSaved
                          ? 'a conciliação dos comprovantes'
                          : '',
                        attachmentsSaved ? 'os anexos' : '',
                      ].filter(Boolean);
                      if (savedParts.length > 0) await onChanged();
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
              className="shrink-0 space-y-1.5 border-b bg-muted/30 p-2 sm:p-3"
              data-report-controls
            >
              <div className="grid grid-cols-3 gap-1">
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
              </div>
              <div className="grid grid-cols-2 gap-1">
                <Button
                  className="h-9"
                  onClick={() => setIncludePhotos((value) => !value)}
                  size="sm"
                  variant={includePhotos ? 'secondary' : 'ghost'}
                >
                  <Camera /> Fotos
                </Button>
                <Button
                  className="h-9"
                  onClick={() => setIncludeReceipts((value) => !value)}
                  size="sm"
                  variant={includeReceipts ? 'secondary' : 'ghost'}
                >
                  <FileCheck2 /> Comprovantes
                </Button>
              </div>
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
                  <p
                    className={cn(
                      'report-section mt-3 rounded-lg border px-3 py-2 text-sm font-semibold',
                      sale.receivedDifferenceCents < 0
                        ? 'border-rose-200 bg-rose-50 text-rose-950'
                        : 'border-violet-200 bg-violet-50 text-violet-950',
                    )}
                  >
                    {paymentDifferenceText(sale)} · Valor da venda:{' '}
                    {formatMoney(sale.productsTotalCents)} · Total pago:{' '}
                    {formatMoney(sale.receivedTotalCents)}.
                  </p>
                )}
                <div
                  className={cn(
                    'report-section mt-3 rounded-lg border px-3 py-2 text-sm',
                    sale.reconciliation.status === 'reconciled' &&
                      'border-emerald-200 bg-emerald-50 text-emerald-950',
                    sale.reconciliation.status === 'pending' &&
                      'border-amber-200 bg-amber-50 text-amber-950',
                    sale.reconciliation.status === 'divergent' &&
                      'border-rose-200 bg-rose-50 text-rose-950',
                  )}
                >
                  <p className="font-extrabold">
                    {sale.productsTotalCents <= 0
                      ? 'Venda sem valor definido'
                      : sale.reconciliation.status === 'reconciled'
                        ? 'Conciliado'
                        : sale.reconciliation.status === 'divergent'
                          ? 'Verificar venda'
                          : 'Conciliação pendente'}
                  </p>
                  <p className="mt-0.5">
                    Comprovantes confirmados:{' '}
                    {formatMoney(sale.reconciliation.confirmedTotalCents)} ·
                    Total da venda: {formatMoney(sale.productsTotalCents)}
                    {sale.reconciliation.status === 'divergent'
                      ? ` · ${(sale.reconciliation.differenceCents ?? 0) < 0 ? 'Falta' : 'Sobra'} ${formatMoney(Math.abs(sale.reconciliation.differenceCents ?? 0))}`
                      : ''}
                  </p>
                </div>
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
                      {sale.payments.length === 0 ? (
                        <div className="report-row rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
                          Pagamento não informado — pendente
                        </div>
                      ) : (
                        sale.payments.map((payment) => (
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
                        ))
                      )}
                    </div>
                  </section>
                )}
                {includeReceipts && sale.receipts.length > 0 && (
                  <section className="report-section mt-5">
                    <h3 className="font-extrabold">
                      Comprovantes da venda #
                      {String(sale.number).padStart(5, '0')}
                    </h3>
                    <div className="mt-2 divide-y rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs">
                      {sale.receipts.map((receipt) => (
                        <div
                          className="flex justify-between gap-3 py-2"
                          key={`receipt-value-${receipt.id}`}
                        >
                          <span className="min-w-0 truncate">
                            {receipt.name}
                          </span>
                          <strong className="shrink-0">
                            {receipt.receiptAmountCents === null
                              ? 'Não conferido'
                              : formatMoney(receipt.receiptAmountCents)}
                          </strong>
                        </div>
                      ))}
                    </div>
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

function SalesPeriodReport({
  open,
  storeName,
  filterParams,
  filterSummary,
  period,
  onOpenChange,
}: {
  open: boolean;
  storeName: string;
  filterParams: string;
  filterSummary: string;
  period: PeriodFilter;
  onOpenChange: (open: boolean) => void;
}) {
  const [level, setLevel] = useState<ReportLevel>('simple');
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadRevision, setLoadRevision] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [generatedAt, setGeneratedAt] = useState(() => Date.now());
  const reportRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setLoadError('');
      setPdfError('');
      setSales([]);
      setGeneratedAt(Date.now());
      void fetchSalesForPeriodReport(filterParams)
        .then((records) => {
          if (!ignore) setSales(records);
        })
        .catch((error) => {
          if (!ignore) setLoadError(messageOf(error));
        })
        .finally(() => {
          if (!ignore) setLoading(false);
        });
    }, 0);
    return () => {
      ignore = true;
      window.clearTimeout(timer);
    };
  }, [filterParams, loadRevision, open]);

  const completedSales = useMemo(
    () => sales.filter((sale) => sale.status === 'completed'),
    [sales],
  );
  const dayGroups = useMemo(() => groupSalesByDay(sales), [sales]);
  const modelGroups = useMemo(
    () => groupModelsAcrossSales(completedSales),
    [completedSales],
  );
  const amountCents = completedSales.reduce(
    (sum, sale) => sum + sale.productsTotalCents,
    0,
  );
  const itemCount = completedSales.reduce(
    (sum, sale) => sum + sale.items.length,
    0,
  );
  const alertCount = completedSales.filter(
    (sale) =>
      sale.receivedDifferenceCents !== 0 ||
      sale.receipts.length === 0 ||
      sale.reconciliation.status !== 'reconciled',
  ).length;
  const cancelledCount = sales.length - completedSales.length;
  const completeMediaStats = useMemo(
    () =>
      completedSales.reduce(
        (total, sale) => {
          sale.receipts.forEach((receipt) => {
            total.count += 1;
            total.bytes += receipt.sizeBytes;
          });
          sale.items.forEach((item) => {
            item.photos.forEach((photo) => {
              total.count += 1;
              total.bytes += photo.sizeBytes;
            });
          });
          return total;
        },
        { bytes: 0, count: 0 },
      ),
    [completedSales],
  );
  const completeMediaTooLarge =
    completeMediaStats.count > PERIOD_REPORT_MEDIA_LIMIT ||
    completeMediaStats.bytes > PERIOD_REPORT_MEDIA_BYTES_LIMIT;

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && pdfBusy) return;
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 rounded-none p-0 sm:h-[92dvh] sm:max-w-5xl sm:rounded-2xl">
        <DialogHeader
          className="shrink-0 border-b px-4 py-3 pr-12"
          data-report-controls
        >
          <DialogTitle>Relatório de vendas</DialogTitle>
          <DialogDescription>
            Reúne todas as vendas do filtro selecionado, separadas por venda.
          </DialogDescription>
        </DialogHeader>
        <div
          className="shrink-0 border-b bg-muted/30 p-2 sm:p-3"
          data-report-controls
        >
          <div className="grid grid-cols-3 gap-1">
            {(['simple', 'detailed', 'complete'] as const).map((value) => (
              <Button
                className="h-10 px-2 text-xs font-extrabold sm:text-sm"
                disabled={loading || pdfBusy}
                key={value}
                onClick={() => setLevel(value)}
                variant={level === value ? 'default' : 'outline'}
              >
                {value === 'simple'
                  ? 'Simplificado'
                  : value === 'detailed'
                    ? 'Detalhado'
                    : 'Completo'}
              </Button>
            ))}
          </div>
          <p className="mt-2 truncate px-1 text-xs font-semibold text-muted-foreground">
            {filterSummary}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/25 p-2 overscroll-contain sm:p-5">
          {loading ? (
            <div className="grid min-h-60 place-items-center text-center">
              <div>
                <LoaderCircle className="mx-auto size-7 animate-spin text-primary" />
                <p className="mt-3 text-sm font-bold">
                  Preparando as vendas do período…
                </p>
              </div>
            </div>
          ) : loadError ? (
            <div className="grid min-h-60 place-items-center p-6 text-center">
              <div>
                <AlertTriangle className="mx-auto size-8 text-destructive" />
                <p className="mt-3 text-sm font-semibold text-destructive">
                  {loadError}
                </p>
                <Button
                  className="mt-3"
                  onClick={() => setLoadRevision((value) => value + 1)}
                >
                  Tentar novamente
                </Button>
              </div>
            </div>
          ) : (
            <article
              className="report-document mx-auto max-w-4xl rounded-2xl bg-white p-4 text-slate-950 shadow-sm ring-1 ring-slate-200 sm:p-7"
              data-print-report
              ref={reportRef}
            >
              <header className="border-b border-slate-200 pb-4">
                <p className="text-xs font-bold uppercase tracking-[.16em] text-slate-500">
                  {storeName}
                </p>
                <h2 className="mt-1 text-xl font-extrabold">
                  Relatório de vendas · {reportName(level)}
                </h2>
                <p className="mt-1 text-sm font-semibold text-slate-600">
                  {filterSummary}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Gerado em {formatDateTime(generatedAt)}
                </p>
              </header>

              <dl className="report-section mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
                <div className="col-span-3 overflow-hidden rounded-xl bg-gradient-to-br from-emerald-700 via-emerald-600 to-cyan-600 p-4 text-white shadow-sm sm:col-span-2">
                  <dt className="text-[.68rem] font-black uppercase tracking-[.12em] text-emerald-50/90">
                    {reportAmountLabel(period)}
                  </dt>
                  <dd className="mt-1 text-2xl font-black tracking-[-.04em] sm:text-3xl">
                    {formatMoney(amountCents)}
                  </dd>
                </div>
                <ReportMetric
                  label="Vendas concluídas"
                  value={String(completedSales.length)}
                />
                <ReportMetric label="Aparelhos" value={String(itemCount)} />
                <ReportMetric label="Avisos" value={String(alertCount)} />
              </dl>

              {cancelledCount > 0 && (
                <p className="report-section mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                  {cancelledCount}{' '}
                  {cancelledCount === 1
                    ? 'venda cancelada aparece'
                    : 'vendas canceladas aparecem'}{' '}
                  apenas para registro e não entram nos totais.
                </p>
              )}

              {level === 'complete' && completeMediaTooLarge && (
                <div className="report-section mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  <p className="font-extrabold">
                    Reduza o período para incluir as fotos com segurança.
                  </p>
                  <p className="mt-1">
                    Este filtro possui {completeMediaStats.count} arquivos (
                    {formatMediaBytes(completeMediaStats.bytes)}). O relatório
                    completo aceita até {PERIOD_REPORT_MEDIA_LIMIT} arquivos e{' '}
                    {formatMediaBytes(PERIOD_REPORT_MEDIA_BYTES_LIMIT)} por vez
                    para não travar o celular. Os relatórios simplificado e
                    detalhado continuam disponíveis.
                  </p>
                </div>
              )}

              <section className="report-section mt-5">
                <h3 className="font-extrabold">Quantidade por aparelho</h3>
                <div className="mt-2 space-y-2">
                  {modelGroups.length === 0 ? (
                    <p className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600">
                      Nenhum aparelho vendido neste filtro.
                    </p>
                  ) : (
                    modelGroups.map((group) => (
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
                            {group.items.map(({ item, sale }) => (
                              <code
                                className="rounded bg-slate-100 px-2 py-1 text-xs"
                                key={`${sale.id}:${item.id}`}
                              >
                                {item.serial} · #
                                {String(sale.number).padStart(5, '0')}
                              </code>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="mt-5">
                <h3 className="report-section font-extrabold">
                  Vendas separadas por dia
                </h3>
                <div className="mt-2 space-y-5">
                  {sales.length === 0 ? (
                    <p className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600">
                      Nenhuma venda encontrada neste filtro.
                    </p>
                  ) : (
                    dayGroups.map((day) => (
                      <section
                        className="rounded-2xl border border-slate-200 bg-slate-50/70 p-2 sm:p-3"
                        key={day.key}
                      >
                        <header className="report-section grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl bg-gradient-to-r from-slate-950 to-blue-950 px-3 py-3 text-white">
                          <div className="min-w-0">
                            <p className="break-words text-sm font-black leading-tight">
                              {formatReportDay(day.newestAt)}
                            </p>
                            <p className="mt-1 text-xs font-semibold text-blue-100">
                              {day.completedCount}{' '}
                              {day.completedCount === 1
                                ? 'venda concluída'
                                : 'vendas concluídas'}{' '}
                              · {day.itemCount}{' '}
                              {day.itemCount === 1 ? 'aparelho' : 'aparelhos'}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[.62rem] font-black uppercase tracking-[.12em] text-blue-200">
                              Total do dia
                            </p>
                            <strong className="mt-0.5 block text-lg leading-none">
                              {formatMoney(day.totalCents)}
                            </strong>
                          </div>
                        </header>

                        <div className="mt-3 space-y-3">
                          {day.sales.map((sale) => (
                            <section
                              className={cn(
                                'report-row rounded-xl border-2 p-3 shadow-sm',
                                sale.status === 'cancelled' &&
                                  'border-slate-300 bg-slate-100/80',
                                sale.status === 'completed' &&
                                  sale.receivedDifferenceCents < 0 &&
                                  'border-rose-300 bg-rose-50/30',
                                sale.status === 'completed' &&
                                  sale.receivedDifferenceCents > 0 &&
                                  'border-violet-300 bg-violet-50/30',
                                sale.status === 'completed' &&
                                  sale.receivedDifferenceCents === 0 &&
                                  'border-blue-200 bg-white',
                              )}
                              key={sale.id}
                            >
                              <div
                                className={cn(
                                  'grid gap-3 rounded-lg p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center',
                                  sale.status === 'cancelled'
                                    ? 'bg-slate-200/70'
                                    : sale.receivedDifferenceCents < 0
                                      ? 'bg-rose-100/80'
                                      : sale.receivedDifferenceCents > 0
                                        ? 'bg-violet-100/80'
                                        : 'bg-blue-50',
                                )}
                              >
                                <div className="min-w-0">
                                  <p className="break-words font-extrabold leading-tight">
                                    Venda #
                                    {String(sale.number).padStart(5, '0')} ·{' '}
                                    {sale.customerName}
                                  </p>
                                  <p className="mt-1 break-words text-xs text-slate-600">
                                    {formatDateTime(sale.createdAt)} ·{' '}
                                    {sale.sellerName}
                                  </p>
                                </div>

                                {sale.status === 'cancelled' ? (
                                  <strong className="rounded-full bg-slate-700 px-3 py-1 text-center text-xs text-white sm:justify-self-end">
                                    Cancelada
                                  </strong>
                                ) : (
                                  <dl className="grid grid-cols-2 gap-2 sm:min-w-64">
                                    <div className="rounded-lg bg-white/80 px-2 py-2">
                                      <dt className="text-[.62rem] font-black uppercase tracking-wide text-slate-500">
                                        Valor da venda
                                      </dt>
                                      <dd className="mt-0.5 break-words text-sm font-extrabold">
                                        {formatMoney(sale.productsTotalCents)}
                                      </dd>
                                    </div>
                                    <div className="rounded-lg bg-white/80 px-2 py-2">
                                      <dt className="text-[.62rem] font-black uppercase tracking-wide text-slate-500">
                                        Total pago
                                      </dt>
                                      <dd className="mt-0.5 break-words text-sm font-extrabold">
                                        {formatMoney(sale.receivedTotalCents)}
                                      </dd>
                                    </div>
                                  </dl>
                                )}
                              </div>

                              {sale.status === 'completed' &&
                                sale.receivedDifferenceCents !== 0 && (
                                  <p
                                    className={cn(
                                      'mt-2 rounded-lg border px-3 py-2 text-sm font-extrabold',
                                      sale.receivedDifferenceCents < 0
                                        ? 'border-rose-200 bg-rose-100 text-rose-950'
                                        : 'border-violet-200 bg-violet-100 text-violet-950',
                                    )}
                                  >
                                    {paymentDifferenceText(sale)}
                                  </p>
                                )}

                              <div className="mt-2 divide-y divide-slate-100">
                                {sale.items.map((item) => (
                                  <div
                                    className="flex items-start justify-between gap-3 py-2 text-sm"
                                    key={item.id}
                                  >
                                    <span className="min-w-0">
                                      <strong>{item.productName}</strong>
                                      <span className="block text-xs text-slate-600">
                                        {item.productDetail}
                                        {level !== 'simple'
                                          ? ` · SN ${item.serial}`
                                          : ''}
                                      </span>
                                    </span>
                                    <strong className="shrink-0">
                                      {formatMoney(item.soldPriceCents)}
                                    </strong>
                                  </div>
                                ))}
                              </div>

                              {level !== 'simple' &&
                                sale.status === 'completed' && (
                                  <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs">
                                    <p className="font-extrabold">Pagamentos</p>
                                    {sale.payments.length === 0 ? (
                                      <p className="mt-1 text-amber-800">
                                        Pagamento não informado — pendente
                                      </p>
                                    ) : (
                                      sale.payments.map((payment) => (
                                        <p
                                          className="mt-1 flex justify-between gap-3"
                                          key={payment.id}
                                        >
                                          <span>
                                            {payment.method === 'pix'
                                              ? `Pix${payment.accountName ? ` · ${payment.accountName}` : ''}`
                                              : 'Dinheiro'}
                                          </span>
                                          <strong>
                                            {formatMoney(payment.amountCents)}
                                          </strong>
                                        </p>
                                      ))
                                    )}
                                  </div>
                                )}

                              {level === 'complete' &&
                                sale.status === 'completed' && (
                                  <div className="mt-2 space-y-2">
                                    <div
                                      className={cn(
                                        'rounded-lg px-3 py-2 text-xs',
                                        sale.reconciliation.status ===
                                          'reconciled' &&
                                          'bg-emerald-50 text-emerald-950',
                                        sale.reconciliation.status ===
                                          'pending' &&
                                          'bg-amber-50 text-amber-950',
                                        sale.reconciliation.status ===
                                          'divergent' &&
                                          'bg-rose-50 text-rose-950',
                                      )}
                                    >
                                      <p className="font-extrabold">
                                        {sale.reconciliation.status ===
                                        'reconciled'
                                          ? 'Conciliado'
                                          : sale.reconciliation.status ===
                                              'divergent'
                                            ? 'Verificar venda'
                                            : 'Conciliação pendente'}
                                      </p>
                                      <p>
                                        Comprovantes:{' '}
                                        {formatMoney(
                                          sale.reconciliation
                                            .confirmedTotalCents,
                                        )}{' '}
                                        · Venda:{' '}
                                        {formatMoney(sale.productsTotalCents)}
                                        {sale.reconciliation.status ===
                                        'divergent'
                                          ? ` · ${(sale.reconciliation.differenceCents ?? 0) < 0 ? 'Falta' : 'Sobra'} ${formatMoney(Math.abs(sale.reconciliation.differenceCents ?? 0))}`
                                          : ''}
                                      </p>
                                    </div>

                                    {!completeMediaTooLarge &&
                                      sale.items.some(
                                        (item) => item.photos.length > 0,
                                      ) && (
                                        <div>
                                          <p className="text-xs font-extrabold">
                                            Fotos dos aparelhos
                                          </p>
                                          <div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-5">
                                            {sale.items.flatMap((item) =>
                                              item.photos.map((photo) => (
                                                <a
                                                  href={photo.url}
                                                  key={photo.id}
                                                  rel="noreferrer"
                                                  target="_blank"
                                                >
                                                  <img
                                                    alt={`${item.productName} · SN ${item.serial}`}
                                                    className="aspect-square w-full rounded-lg border border-slate-200 object-cover"
                                                    src={photo.url}
                                                  />
                                                </a>
                                              )),
                                            )}
                                          </div>
                                        </div>
                                      )}

                                    {!completeMediaTooLarge &&
                                      sale.receipts.length > 0 && (
                                        <div>
                                          <p className="text-xs font-extrabold">
                                            Comprovantes da venda #
                                            {String(sale.number).padStart(
                                              5,
                                              '0',
                                            )}
                                          </p>
                                          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                            {sale.receipts.map((receipt) =>
                                              receipt.mimeType ===
                                              'application/pdf' ? (
                                                <a
                                                  className="rounded-lg border border-slate-200 p-3 text-xs font-bold"
                                                  href={receipt.url}
                                                  key={receipt.id}
                                                  rel="noreferrer"
                                                  target="_blank"
                                                >
                                                  <FileText className="mb-1 size-4" />
                                                  {receipt.name}
                                                </a>
                                              ) : (
                                                <a
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
                                        </div>
                                      )}
                                  </div>
                                )}
                            </section>
                          ))}
                        </div>
                      </section>
                    ))
                  )}
                </div>
              </section>
            </article>
          )}
        </div>
        <DialogFooter
          className="m-0 shrink-0 rounded-none border-t bg-background p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))]"
          data-report-controls
        >
          {pdfError && (
            <p className="mr-auto text-left text-sm font-semibold text-destructive">
              {pdfError}
            </p>
          )}
          <Button
            disabled={pdfBusy}
            onClick={() => onOpenChange(false)}
            variant="outline"
          >
            Fechar
          </Button>
          <Button
            disabled={
              loading ||
              Boolean(loadError) ||
              pdfBusy ||
              sales.length === 0 ||
              (level === 'complete' && completeMediaTooLarge)
            }
            onClick={async () => {
              if (!reportRef.current) return;
              setPdfBusy(true);
              setPdfError('');
              try {
                await downloadReportPdf({
                  element: reportRef.current,
                  fileName: `relatorio-vendas-${dateKey(Date.now())}-${reportName(level)}`,
                  pdfAttachments:
                    level === 'complete'
                      ? completedSales.flatMap((sale) =>
                          sale.receipts
                            .filter(
                              (receipt) =>
                                receipt.mimeType === 'application/pdf',
                            )
                            .map((receipt) => ({
                              name: `venda-${String(sale.number).padStart(5, '0')}-${receipt.name}`,
                              url: receipt.url,
                            })),
                        )
                      : [],
                });
              } catch (error) {
                setPdfError(messageOf(error));
              } finally {
                setPdfBusy(false);
              }
            }}
          >
            {pdfBusy ? <LoaderCircle className="animate-spin" /> : <Download />}
            {pdfBusy ? 'Gerando PDF…' : 'Baixar PDF'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function fetchSalesForPeriodReport(filterParams: string) {
  const records: SaleRecord[] = [];
  let cursor: string | null = null;
  const seenCursors = new Set<string>();

  while (true) {
    const params = new URLSearchParams(filterParams);
    params.set('group', 'sale');
    params.set('limit', '99');
    if (cursor) params.set('cursor', cursor);
    const page = await requestJson<SalesPage>(
      `/api/sales?${params.toString()}`,
    );
    if (page.total > PERIOD_REPORT_SALES_LIMIT) {
      throw new Error(
        `Este filtro possui ${page.total} vendas. Selecione um período menor, com até ${PERIOD_REPORT_SALES_LIMIT}, para gerar o PDF com segurança no celular.`,
      );
    }
    records.push(...page.items);
    if (!page.nextCursor) return records;
    if (seenCursors.has(page.nextCursor)) {
      throw new Error('Não foi possível continuar a leitura das vendas.');
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
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
type WarningTone =
  | 'information'
  | 'overpayment'
  | 'payment'
  | 'processing'
  | 'receipt'
  | 'reconciliation';

function WarningBadge({ text, tone }: { text: string; tone: WarningTone }) {
  const Icon =
    tone === 'payment' || tone === 'overpayment'
      ? WalletCards
      : tone === 'receipt'
        ? Paperclip
        : tone === 'processing'
          ? ReceiptText
          : CircleAlert;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[.68rem] font-extrabold',
        tone === 'payment' &&
          'border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-900 dark:bg-rose-950/45 dark:text-rose-200',
        tone === 'overpayment' &&
          'border-violet-200 bg-violet-100 text-violet-800 dark:border-violet-900 dark:bg-violet-950/45 dark:text-violet-200',
        tone === 'receipt' &&
          'border-orange-200 bg-orange-100 text-orange-800 dark:border-orange-900 dark:bg-orange-950/45 dark:text-orange-200',
        tone === 'processing' &&
          'border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-900 dark:bg-sky-950/45 dark:text-sky-200',
        tone === 'reconciliation' &&
          'border-fuchsia-200 bg-fuchsia-100 text-fuchsia-800 dark:border-fuchsia-900 dark:bg-fuchsia-950/45 dark:text-fuchsia-200',
        tone === 'information' &&
          'border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
      )}
    >
      <Icon className="size-3" />
      {text}
    </span>
  );
}
function SuccessBadge({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/12 px-1.5 py-1 text-[.68rem] font-bold text-emerald-800 dark:text-emerald-200">
      <FileCheck2 className="size-3" />
      {text}
    </span>
  );
}
function Metric({
  label,
  mobileLabel,
  value,
  mobileValue,
  active = false,
  comparison,
  onClick,
  tone = 'blue',
}: {
  label: string;
  mobileLabel?: string;
  value: string;
  mobileValue?: string;
  active?: boolean;
  comparison?: {
    current: number;
    inverse?: boolean;
    label: string;
    previous: number;
    previousDisplay: string;
  } | null;
  onClick?: () => void;
  tone?: 'amber' | 'blue' | 'emerald' | 'violet';
}) {
  const toneClasses = {
    amber:
      'border-amber-200/80 bg-gradient-to-br from-amber-50 via-background to-orange-50/70 dark:border-amber-900/60 dark:from-amber-950/35 dark:to-orange-950/15',
    blue: 'border-blue-200/80 bg-gradient-to-br from-blue-50 via-background to-cyan-50/70 dark:border-blue-900/60 dark:from-blue-950/35 dark:to-cyan-950/15',
    emerald:
      'border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-background to-teal-50/70 dark:border-emerald-900/60 dark:from-emerald-950/35 dark:to-teal-950/15',
    violet:
      'border-violet-200/80 bg-gradient-to-br from-violet-50 via-background to-fuchsia-50/60 dark:border-violet-900/60 dark:from-violet-950/35 dark:to-fuchsia-950/15',
  } as const;
  const comparisonText = comparison
    ? metricComparisonText(
        comparison.current,
        comparison.previous,
        comparison.previousDisplay,
        comparison.label,
      )
    : null;
  const mobileComparisonText = comparison
    ? metricMobileComparisonText(
        comparison.current,
        comparison.previous,
        comparison.label,
      )
    : null;
  const movedUp = comparison ? comparison.current > comparison.previous : false;
  const movedDown = comparison
    ? comparison.current < comparison.previous
    : false;
  const favorable = comparison?.inverse ? movedDown : movedUp;
  const unfavorable = comparison?.inverse ? movedUp : movedDown;
  const content = (
    <Card
      className={cn(
        'gap-0 overflow-hidden rounded-lg py-0 transition-all sm:h-full sm:rounded-xl sm:py-3',
        toneClasses[tone],
        onClick && 'hover:border-primary/45 hover:bg-secondary/35',
        active && 'border-primary ring-2 ring-primary/25',
      )}
      size="sm"
    >
      <CardContent className="p-1.5 sm:p-3.5">
        <p className="truncate text-xs font-black uppercase tracking-[-.02em] text-muted-foreground sm:tracking-[.08em]">
          <span className="sm:hidden">{mobileLabel ?? label}</span>
          <span className="hidden sm:inline">{label}</span>
        </p>
        <p
          className="mt-0.5 truncate text-sm font-black tracking-[-.045em] sm:mt-1 sm:text-xl sm:tracking-[-.035em]"
          title={value}
        >
          <span className="sm:hidden">{mobileValue ?? value}</span>
          <span className="hidden sm:inline">{value}</span>
        </p>
        {comparisonText && (
          <>
            <p
              className={cn(
                'mt-0.5 truncate text-[.65rem] font-extrabold leading-none sm:hidden',
                favorable && 'text-emerald-700 dark:text-emerald-300',
                unfavorable && 'text-rose-700 dark:text-rose-300',
                !favorable && !unfavorable && 'text-muted-foreground',
              )}
              title={comparisonText}
            >
              {movedUp ? '↑ ' : movedDown ? '↓ ' : '→ '}
              {mobileComparisonText}
            </p>
            <p
              className={cn(
                'mt-1 hidden truncate text-xs font-bold sm:block',
                favorable && 'text-emerald-700 dark:text-emerald-300',
                unfavorable && 'text-rose-700 dark:text-rose-300',
                !favorable && !unfavorable && 'text-muted-foreground',
              )}
              title={comparisonText}
            >
              {movedUp ? '↑ ' : movedDown ? '↓ ' : '→ '}
              {comparisonText}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
  if (!onClick) return content;
  return (
    <button
      aria-label={`${label}: ${value}${comparisonText ? `. Comparação: ${comparisonText}` : ''}`}
      aria-pressed={active}
      className="min-w-0 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:rounded-xl"
      onClick={onClick}
      type="button"
    >
      {content}
    </button>
  );
}

function metricComparisonText(
  current: number,
  previous: number,
  previousDisplay: string,
  label: string,
) {
  if (previous === 0) {
    return current === 0
      ? `Sem mudança · ${label}: 0`
      : `Período anterior (${label}): 0`;
  }
  const percent = Math.round(((current - previous) / previous) * 100);
  return `${percent > 0 ? '+' : ''}${percent}% vs. ${label} (${previousDisplay})`;
}

function metricMobileComparisonText(
  current: number,
  previous: number,
  label: string,
) {
  if (previous === 0) return `${label}: 0`;
  const percent = Math.round(((current - previous) / previous) * 100);
  return `${percent > 0 ? '+' : ''}${percent}%`;
}

function SalesFilterSelect<T extends string>({
  'aria-label': ariaLabel,
  onValueChange,
  options,
  tone,
  value,
}: {
  'aria-label': string;
  onValueChange: (value: T) => void;
  options: Array<FilterOption<T>>;
  tone: 'amber' | 'emerald' | 'fuchsia';
  value: T;
}) {
  const selected = options.find((option) => option.value === value);
  const tones = {
    amber:
      'border-amber-200/90 bg-amber-50/80 text-amber-950 hover:bg-amber-100/80 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-50',
    emerald:
      'border-emerald-200/90 bg-emerald-50/80 text-emerald-950 hover:bg-emerald-100/80 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-50',
    fuchsia:
      'border-fuchsia-200/90 bg-fuchsia-50/80 text-fuchsia-950 hover:bg-fuchsia-100/80 dark:border-fuchsia-900/70 dark:bg-fuchsia-950/30 dark:text-fuchsia-50',
  } as const;
  const selectedTones = {
    amber: 'data-selected:bg-amber-100 data-selected:text-amber-950',
    emerald: 'data-selected:bg-emerald-100 data-selected:text-emerald-950',
    fuchsia: 'data-selected:bg-fuchsia-100 data-selected:text-fuchsia-950',
  } as const;

  return (
    <Select
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      value={value}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          'h-11 w-full rounded-xl px-3 text-left font-extrabold tracking-[-.01em] shadow-sm focus-visible:ring-2',
          tones[tone],
        )}
      >
        <SelectValue>{selected?.label ?? 'Selecionar'}</SelectValue>
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        className="min-w-[min(21rem,calc(100vw-1rem))] rounded-2xl border bg-popover p-1.5 shadow-2xl"
        sideOffset={6}
      >
        {options.map((option) => (
          <SelectItem
            className={cn(
              'min-h-14 rounded-xl px-3 py-2.5 pr-9 focus:bg-accent',
              selectedTones[tone],
            )}
            key={option.value}
            value={option.value}
          >
            <span className="min-w-0">
              <span className="block text-[.95rem] font-extrabold leading-tight tracking-[-.015em]">
                {option.label}
              </span>
              {option.detail && (
                <span className="mt-1 block text-xs font-medium leading-tight text-muted-foreground">
                  {option.detail}
                </span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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

function groupModelsAcrossSales(sales: SaleRecord[]) {
  const groups = new Map<
    string,
    {
      key: string;
      name: string;
      detail: string;
      items: Array<{ item: SaleRecord['items'][number]; sale: SaleRecord }>;
    }
  >();
  sales.forEach((sale) => {
    sale.items.forEach((item) => {
      const key = `${item.productName}\u0000${item.productDetail}`;
      const group = groups.get(key) ?? {
        key,
        name: item.productName,
        detail: item.productDetail,
        items: [],
      };
      group.items.push({ item, sale });
      groups.set(key, group);
    });
  });
  return Array.from(groups.values()).sort(
    (left, right) =>
      right.items.length - left.items.length ||
      left.name.localeCompare(right.name, 'pt-BR'),
  );
}

function groupSalesByDay(sales: SaleRecord[]) {
  const groups = new Map<
    string,
    {
      key: string;
      newestAt: number;
      sales: SaleRecord[];
      completedCount: number;
      itemCount: number;
      totalCents: number;
    }
  >();

  sales.forEach((sale) => {
    const key = dateKey(sale.createdAt);
    const group = groups.get(key) ?? {
      key,
      newestAt: sale.createdAt,
      sales: [],
      completedCount: 0,
      itemCount: 0,
      totalCents: 0,
    };
    group.sales.push(sale);
    group.newestAt = Math.max(group.newestAt, sale.createdAt);
    if (sale.status === 'completed') {
      group.completedCount += 1;
      group.itemCount += sale.items.length;
      group.totalCents += sale.productsTotalCents;
    }
    groups.set(key, group);
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      sales: group.sales.sort(
        (left, right) => right.createdAt - left.createdAt,
      ),
    }))
    .sort((left, right) => right.newestAt - left.newestAt);
}

function paymentDifferenceText(sale: SaleRecord) {
  if (sale.receivedDifferenceCents < 0) {
    return `Falta receber ${formatMoney(-sale.receivedDifferenceCents)}`;
  }
  if (sale.receivedDifferenceCents > 0) {
    return `Recebido a mais ${formatMoney(sale.receivedDifferenceCents)}`;
  }
  return null;
}

function paymentLabel(sale: SaleRecord) {
  if (sale.payments.length === 0) return 'Pagamento não informado';
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

function reportAmountLabel(period: PeriodFilter) {
  if (period === 'today') return 'Total vendido hoje';
  if (period === 'yesterday' || period === 'day') {
    return 'Total vendido no dia';
  }
  return 'Montante total do período';
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}

function formatCompactMoney(cents: number) {
  const amount = cents / 100;
  if (Math.abs(amount) >= 1_000_000) {
    return `R$${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(amount / 1_000_000)}mi`;
  }
  if (Math.abs(amount) >= 1_000) {
    return `R$${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(amount / 1_000)}mil`;
  }
  return `R$${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(amount)}`;
}

function periodDescription(
  period: PeriodFilter,
  selectedDay: string,
  selectedMonth: string,
) {
  if (period === 'day') {
    return `Dia ${new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    }).format(new Date(`${selectedDay}T12:00:00-03:00`))}`;
  }
  if (period === 'month') {
    const [year, month] = selectedMonth.split('-').map(Number);
    return new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
    }).format(new Date(Date.UTC(year, month - 1, 15)));
  }
  return PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? '';
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

function formatReportDay(value: number) {
  const label = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
  }).format(new Date(value));
  return `${label.charAt(0).toLocaleUpperCase('pt-BR')}${label.slice(1)}`;
}

function formatDateTime(value: number) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
