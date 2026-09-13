'use client';
import { saleReceiptIncome, receiptDrivenPayments } from '@/lib/receipt-income';
import { ReceiptPaymentDetails } from '@/components/pdv/receipt-payment-details';

/* oxlint-disable next/no-img-element, jsx-a11y/label-has-associated-control -- report media is authenticated and the custom textarea is wrapped by its label */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { can, canAny } from '@/lib/permissions';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Camera,
  CircleAlert,
  Download,
  Link2,
  RefreshCw,
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

import {
  SaleStatusBadge,
  SaleIssuesNotice,
} from '@/components/pdv/sale-status-badge';
import { saleFinancialSummary } from '@/lib/sale-financial-summary';
import { summarizeSalesPayments } from '@/lib/sales-payment-summary';
import { SalesReportPayments } from '@/components/pdv/sales-report-payments';
import { replaceGuardedUrl } from '@/lib/app-back';
import { salesReportPath, type SalesReportLink } from '@/lib/sales-report-link';
import {
  SYSTEM_SALE_STATUSES,
  SALE_ISSUES,
  SALE_CHECK_STATUSES,
  type SaleIssueKey,
  automaticSaleStatus,
  isAutomaticStatusName,
  saleDisplayStatus,
  saleIssues,
} from '@/lib/sale-display-status';
import { SaleDetailsDialog } from '@/components/pdv/sale-details-dialog';
import { DeleteReceiptButton } from '@/components/pdv/delete-receipt-button';
import { ReceiptPaymentSync } from '@/components/pdv/receipt-payment-sync';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { SalePricesEditor } from '@/components/pdv/sale-prices-editor';
import { applySalePrices, type SalePrices } from '@/lib/sale-prices';
import {
  SaleParticipantsEditor,
  useSaleParticipants,
} from '@/components/pdv/sale-participants-editor';
import { useServerReceiptJobs } from '@/components/pdv/server-receipt-runtime';
import {
  GroupDetailsDialog,
  type SelectedGroup,
} from '@/components/pdv/group-details-dialog';
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
import { parseMoneyInput } from '@/lib/money';
import {
  deriveReceiptReconciliation,
  paymentMethodTotals,
  receiptTargetLabel,
  type ReceiptValueInput,
} from '@/lib/receipt-reconciliation';
import { cn } from '@/lib/utils';
import type {
  BootstrapData,
  SalePaymentRecord,
  SaleRecord,
  SalesAnalytics,
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
type IssueFilter = 'all' | SaleIssueKey;
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
    label: 'Qualquer pendência',
    value: 'all',
  },
  ...SALE_ISSUES.map((issue) => ({
    detail: 'Aviso de conferência, independente do status escolhido',
    label: issue.label,
    value: issue.key,
  })),
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
  initialReport = null,
}: {
  data: BootstrapData;
  onChanged: () => Promise<void>;
  openSaleId?: string | null;
  onOpenSaleHandled?: () => void;
  initialReport?: SalesReportLink | null;
}) {
  const [queryDraft, setQueryDraft] = useState(initialReport?.query ?? '');
  const [query, setQuery] = useState(initialReport?.query ?? '');
  const [period, setPeriod] = useState<PeriodFilter>(() =>
    openSaleId ? 'all' : (initialReport?.period ?? 'today'),
  );
  const [selectedDay, setSelectedDay] = useState(
    () => initialReport?.day || dateKey(Date.now()),
  );
  const [selectedMonth, setSelectedMonth] = useState(
    () => initialReport?.month || dateKey(Date.now()).slice(0, 7),
  );
  const [grouping, setGrouping] = useState<Grouping>('sale');
  const [alertOnly, setAlertOnly] = useState(initialReport?.alertOnly ?? false);
  const [issueFilter, setIssueFilter] = useState<IssueFilter>(
    initialReport?.issue ?? 'all',
  );
  const [orderStatusFilter, setOrderStatusFilter] = useState(
    initialReport?.orderStatus ?? 'all',
  );
  const [statusScope, setStatusScope] = useState<'saved' | 'display'>(
    initialReport?.statusScope ?? 'display',
  );
  const [sellerFilter, setSellerFilter] = useState(
    initialReport?.seller ?? 'all',
  );
  const [sellerOptions, setSellerOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [sellerOptionsError, setSellerOptionsError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void requestJson<{ sellers: Array<{ id: string; name: string }> }>(
      '/api/sales?view=seller-options',
      { signal: controller.signal },
    )
      .then((result) => setSellerOptions(result.sellers))
      .catch((error) => {
        if (!controller.signal.aborted) setSellerOptionsError(messageOf(error));
      });
    return () => controller.abort();
  }, [data.store.id]);
  const [sellerRanking, setSellerRanking] = useState<SellerRanking>('items');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [periodReportOpen, setPeriodReportOpen] = useState(
    Boolean(initialReport),
  );
  const [returnToPeriodReport, setReturnToPeriodReport] = useState(false);
  const changePeriodReportOpen = (open: boolean) => {
    setPeriodReportOpen(open);
    if (
      !open &&
      new URLSearchParams(window.location.search).get('report') === 'sales'
    )
      replaceGuardedUrl(window, window.location.pathname);
  };
  const [selectedGroup, setSelectedGroup] = useState<SelectedGroup | null>(
    null,
  );
  const [reportSale, setReportSale] = useState<SaleRecord | null>(null);
  const [detailSale, setDetailSale] = useState<SaleRecord | null>(null);
  const [editSale, setEditSale] = useState<SaleRecord | null>(null);
  const [cancelSale, setCancelSale] = useState<SaleRecord | null>(null);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const ids = [
      ...new Set(
        [editSale?.id, detailSale?.id, reportSale?.id].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];
    const refresh = () => {
      const requestedGeneration = ++generation;
      for (const id of ids)
        void requestJson<SalesPage>(
          `/api/sales?period=all&saleId=${encodeURIComponent(id)}`,
        )
          .then((result) => {
            const record = result.items.find((item) => item.id === id);
            if (!active || !record || requestedGeneration !== generation)
              return;
            setEditSale((current) => (current?.id === id ? record : current));
            setDetailSale((current) => (current?.id === id ? record : current));
            setReportSale((current) => (current?.id === id ? record : current));
          })
          .catch(() => {});
    };
    refresh();
    window.addEventListener('pdv:sales-changed', refresh);
    return () => {
      active = false;
      window.removeEventListener('pdv:sales-changed', refresh);
    };
  }, [editSale?.id, detailSale?.id, reportSale?.id]);
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
  const canCancel = can(data.user, 'sales.cancel');
  const handlePricesChanged = (saleId: string, value: SalePrices) => {
    const update = (record: SaleRecord | null) =>
      record?.id === saleId ? applySalePrices(record, value) : record;
    setPage((current) => ({
      ...current,
      items: current.items.map((record) => update(record)!),
    }));
    setEditSale(update);
    setDetailSale(update);
    setReportSale(update);
    window.dispatchEvent(new Event('pdv:sales-changed'));
  };
  const canEdit = canAny(data.user, [
    'sales.participants',
    'sales.payments',
    'sales.attachments',
    'sales.receipts',
    'sales.receipts.delete',
    'sales.prices',
    'sales.status',
  ]);
  const filterParams = useMemo(() => {
    if (openSaleId)
      return new URLSearchParams({
        period: 'all',
        saleId: openSaleId,
      }).toString();
    const params = new URLSearchParams({ period });
    if (period === 'day') params.set('day', selectedDay);
    if (period === 'month') params.set('month', selectedMonth);
    if (query) params.set('q', query);
    if (alertOnly) params.set('alert', '1');
    if (issueFilter !== 'all') params.set('issue', issueFilter);
    if (sellerFilter !== 'all') params.set('sellerId', sellerFilter);
    if (orderStatusFilter !== 'all') {
      if (orderStatusFilter.startsWith('auto_'))
        params.set('saleStatus', orderStatusFilter.slice(5));
      else {
        params.set('orderStatus', orderStatusFilter);
        params.set('statusScope', statusScope);
      }
    }
    return params.toString();
  }, [
    alertOnly,
    issueFilter,
    openSaleId,
    orderStatusFilter,
    statusScope,
    period,
    query,
    selectedDay,
    selectedMonth,
    sellerFilter,
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
        setDetailSale(target);
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
    if (sellerFilter !== 'all')
      pieces.push(
        `Vendedor: ${sellerOptions.find((seller) => seller.id === sellerFilter)?.name ?? 'selecionado'}`,
      );
    if (alertOnly) pieces.push('Somente vendas com avisos');
    if (issueFilter !== 'all')
      pieces.push(
        `Conferência: ${SALE_ISSUES.find((issue) => issue.key === issueFilter)?.label}`,
      );
    if (orderStatusFilter.startsWith('auto_'))
      pieces.push(
        SALE_CHECK_STATUSES.find(
          (status) => status.key === orderStatusFilter.slice(5),
        )?.label ?? 'Com pendências',
      );
    else if (orderStatusFilter === 'none')
      pieces.push(
        statusScope === 'saved'
          ? 'Sem status salvo (filtro do link anterior)'
          : 'Sem status',
      );
    else if (orderStatusFilter !== 'all') {
      const status = data.orderStatuses.find(
        (candidate) => candidate.id === orderStatusFilter,
      );
      if (status)
        pieces.push(
          `Status ${statusScope === 'saved' ? 'salvo (filtro do link anterior)' : 'da venda'}: ${status.name}`,
        );
    }
    return pieces.join(' · ');
  }, [
    alertOnly,
    data.orderStatuses,
    sellerFilter,
    sellerOptions,
    issueFilter,
    orderStatusFilter,
    period,
    query,
    selectedDay,
    selectedMonth,
    statusScope,
  ]);
  const activeCount =
    grouping === 'sale' ? page.items.length : groupRows.length;
  const activeTotal =
    grouping === 'sale' ? page.total : (analytics?.total ?? 0);
  const additionalFilterCount =
    Number(issueFilter !== 'all') +
    Number(orderStatusFilter !== 'all') +
    Number(sellerFilter !== 'all');

  const reloadActive = async () => {
    if (grouping === 'sale') await loadSales(null, false, true);
    else await loadAnalytics(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-2 py-2 sm:px-4 sm:py-3 lg:px-6">
      <div className="mb-2 flex shrink-0 items-end justify-between gap-3 sm:mb-3">
        <div className="min-w-0">
          <p className="sr-only">Comercial</p>
          <h1 className="text-xl font-black tracking-[-.04em] sm:text-2xl">
            Vendas
          </h1>
          <p className="sr-only">
            Filtre o período, veja por venda, modelo, cliente ou vendedor e abra
            os SNs de cada grupo.
          </p>
        </div>
        <Button
          className="h-9 rounded-xl px-3 font-extrabold shadow-sm"
          onClick={() => setPeriodReportOpen(true)}
          type="button"
        >
          <Download />
          <span className="sm:hidden">Relatório</span>
          <span className="hidden sm:inline">Relatório de vendas</span>
        </Button>
      </div>
      <div className="mb-2 grid shrink-0 grid-cols-4 gap-1 sm:mb-2 sm:gap-2">
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
          mobileLabel="Itens"
          onClick={() => {
            setAlertOnly(false);
            setIssueFilter('all');
            setGrouping('model');
          }}
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
          value={String(activeAggregates.alertCount)}
        />
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 space-y-1.5 border-b bg-muted/20 p-2 sm:p-2.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 md:grid-cols-3 xl:grid-cols-[minmax(12rem,1fr)_10rem_11rem_12rem_11rem]">
            <label className="col-span-2 min-w-0 md:col-span-1">
              <span className="sr-only mb-1 items-center gap-1.5 px-1 text-xs font-black uppercase tracking-[.1em] text-slate-600 dark:text-slate-300">
                <Search className="size-3 text-muted-foreground" /> Pesquisar
                vendas
              </span>
              <span className="relative block">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-10 rounded-xl bg-background pl-9 font-bold tracking-[-.01em] shadow-sm placeholder:font-medium"
                  onChange={(event) => setQueryDraft(event.target.value)}
                  placeholder="Cliente, vendedor, modelo, venda ou SN"
                  value={queryDraft}
                />
              </span>
            </label>
            <div className="min-w-0">
              <span className="mb-1 flex items-center gap-1.5 px-1 text-xs font-black uppercase tracking-[.1em] text-slate-600 dark:text-slate-300">
                <CalendarDays className="size-3 text-muted-foreground" />
                Período
              </span>
              <SalesFilterSelect
                aria-label="Período das vendas"
                onValueChange={setPeriod}
                options={PERIOD_OPTIONS}
                value={period}
              />
            </div>
            <Button
              aria-expanded={mobileFiltersOpen}
              className={cn(
                'h-10 rounded-xl bg-background px-3 font-extrabold shadow-sm md:hidden',
                mobileFiltersOpen &&
                  'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15',
              )}
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
                <span className="mb-1 flex items-center gap-1.5 px-1 text-xs font-black uppercase tracking-[.1em] text-slate-600 dark:text-slate-300">
                  <CircleAlert className="size-3 text-muted-foreground" />
                  Contém pendência
                </span>
                <SalesFilterSelect
                  aria-label="Contém pendência na venda"
                  onValueChange={(next) => {
                    setIssueFilter(next);
                    if (next !== 'all') {
                      setAlertOnly(false);
                      setGrouping('sale');
                    }
                  }}
                  options={ISSUE_OPTIONS}
                  value={issueFilter}
                />
              </div>
              <div className="min-w-0">
                <span className="mb-1 flex items-center gap-1.5 px-1 text-xs font-black uppercase tracking-[.1em] text-slate-600 dark:text-slate-300">
                  <ListFilter className="size-3 text-muted-foreground" /> Status
                  principal
                </span>
                <SalesFilterSelect
                  aria-label="Status da venda"
                  onValueChange={(next) => {
                    setStatusScope('display');
                    setOrderStatusFilter(next);
                  }}
                  options={[
                    {
                      detail: 'Status automáticos e cadastrados',
                      label: 'Todos os status',
                      value: 'all',
                    },
                    {
                      detail:
                        statusScope === 'saved'
                          ? 'Sem cadastro salvo; filtro do link anterior'
                          : 'Venda ainda sem um status',
                      label: 'Sem status',
                      value: 'none',
                    },
                    ...SYSTEM_SALE_STATUSES.map((status) => ({
                      label: status.label,
                      detail: 'Status principal exibido na venda',
                      value: `auto_${status.key}`,
                    })),
                    {
                      label: 'Todas com pendências',
                      detail:
                        'Qualquer pendência de valor, pagamento, foto ou comprovante',
                      value: 'auto_pending',
                    },
                    ...data.orderStatuses
                      .filter((status) => !isAutomaticStatusName(status.name))
                      .map((status) => ({
                        detail: status.active
                          ? 'Status cadastrado pela loja'
                          : 'Status inativo',
                        label: `${status.name}${status.active ? '' : ' (inativo)'}`,
                        value: status.id,
                      })),
                    ...SALE_ISSUES.filter(
                      (issue) => orderStatusFilter === `auto_${issue.key}`,
                    ).map((issue) => ({
                      label: `Conferência: ${issue.label}`,
                      detail: 'Filtro preservado do link anterior',
                      value: `auto_${issue.key}`,
                    })),
                  ]}
                  value={orderStatusFilter}
                />
              </div>
              <div className="col-span-2 min-w-0 md:col-span-1">
                <SalesFilterSelect
                  aria-label="Vendedor das vendas"
                  onValueChange={setSellerFilter}
                  options={[
                    { label: 'Todos os vendedores', value: 'all' },
                    ...sellerOptions.map((seller) => ({
                      label: seller.name,
                      value: seller.id,
                    })),
                  ]}
                  value={sellerFilter}
                />
                {sellerOptionsError && (
                  <p className="mt-1 text-xs text-destructive" role="alert">
                    Não foi possível carregar os vendedores.{' '}
                    {sellerOptionsError}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-[auto_1fr]">
            {(period === 'day' || period === 'month') && (
              <Input
                aria-label={
                  period === 'day' ? 'Dia das vendas' : 'Mês das vendas'
                }
                className="h-9 rounded-xl bg-background font-bold md:w-44"
                onChange={(event) => {
                  if (!event.target.value) return;
                  if (period === 'day') setSelectedDay(event.target.value);
                  else setSelectedMonth(event.target.value);
                }}
                type={period === 'day' ? 'date' : 'month'}
                value={period === 'day' ? selectedDay : selectedMonth}
              />
            )}
            <div
              aria-label="Agrupar vendas"
              className="grid grid-cols-4 gap-1 rounded-2xl bg-slate-200/65 p-1 dark:bg-slate-900/70 md:ml-auto md:w-[36rem]"
            >
              {(
                [
                  ['sale', 'Por venda', 'Venda', ReceiptText],
                  ['model', 'Por modelo', 'Modelo', Smartphone],
                  ['customer', 'Por cliente', 'Cliente', UsersRound],
                  ['seller', 'Por vendedor', 'Vendedor', UserRound],
                ] as const
              ).map(([value, label, mobileLabel, Icon]) => {
                const selected = grouping === value;
                return (
                  <Button
                    aria-pressed={selected}
                    aria-label={label}
                    className={cn(
                      'h-9 min-w-0 gap-1 rounded-lg px-1 text-xs font-bold tracking-[.015em] shadow-none transition-all sm:px-2 sm:text-sm',
                      selected
                        ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                        : 'text-muted-foreground hover:bg-background hover:text-foreground',
                    )}
                    key={value}
                    onClick={() => {
                      setGrouping(value);
                      if (value !== 'sale') setAlertOnly(false);
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    <Icon className="hidden size-3.5 shrink-0 sm:block" />
                    <span className="sm:hidden">{mobileLabel}</span>
                    <span className="hidden sm:inline">{label}</span>
                  </Button>
                );
              })}
            </div>
          </div>
          {grouping === 'seller' && (
            <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
              <span className="mr-auto flex items-center gap-1 font-extrabold sm:mr-0">
                <Trophy className="size-3.5 text-muted-foreground" /> Ordenar
                ranking
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
            <div
              className="grid min-h-52 place-items-center p-6 text-center"
              role="alert"
            >
              <div>
                <AlertTriangle className="mx-auto size-8 text-destructive" />
                <p className="mt-3 text-sm font-semibold text-destructive">
                  {activeError}
                </p>
                <Button
                  className="mt-3 h-11"
                  onClick={() => void reloadActive()}
                >
                  Tentar novamente
                </Button>
              </div>
            </div>
          ) : activeLoading && activeCount === 0 ? (
            <output
              aria-live="polite"
              className="grid min-h-52 place-items-center text-sm font-semibold text-muted-foreground"
            >
              <span className="flex items-center gap-2">
                <LoaderCircle className="size-5 animate-spin text-primary" />
                Carregando vendas…
              </span>
            </output>
          ) : activeCount === 0 ? (
            <Empty
              hasAny={
                Boolean(query) ||
                period !== 'all' ||
                alertOnly ||
                issueFilter !== 'all' ||
                orderStatusFilter !== 'all' ||
                sellerFilter !== 'all' ||
                Boolean(openSaleId) ||
                activeTotal > 0
              }
            />
          ) : grouping === 'sale' ? (
            <>
              <SaleList onDetails={setDetailSale} sales={page.items} />
              {listError && (
                <div
                  className="border-t bg-destructive/5 p-3 text-center"
                  role="alert"
                >
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
      <SaleDetailsDialog
        key={detailSale?.id ?? 'closed-sale-details'}
        sale={detailSale}
        canEditPrices={can(data.user, 'sales.prices')}
        csrfToken={data.csrfToken}
        onPricesChanged={handlePricesChanged}
        onClose={(reason) => {
          setDetailSale(null);
          if (returnToPeriodReport && reason !== 'action') {
            setReturnToPeriodReport(false);
            setPeriodReportOpen(true);
          }
        }}
        closeLabel={returnToPeriodReport ? 'Voltar ao relatório' : 'Fechar'}
        onReport={setReportSale}
        onEdit={setEditSale}
        onCancel={setCancelSale}
        canEdit={canEdit}
        canCancel={canCancel}
      />
      <SaleReport
        onOpenChange={(open) => {
          if (!open) {
            setReportSale(null);
            if (returnToPeriodReport) {
              setReturnToPeriodReport(false);
              setPeriodReportOpen(true);
            }
          }
        }}
        sale={reportSale}
        storeName={data.store.name}
      />
      <SalesPeriodReport
        filterParams={filterParams}
        filterSummary={reportFilterSummary}
        onOpenChange={changePeriodReportOpen}
        open={periodReportOpen}
        period={period}
        storeName={data.store.name}
        storeId={data.store.id}
        initialLevel={initialReport?.level}
        onOpenSale={(sale) => {
          setPeriodReportOpen(false);
          setReturnToPeriodReport(true);
          setDetailSale(sale);
        }}
      />
      <EditSaleDialog
        data={data}
        key={editSale?.id ?? 'closed-sale-editor'}
        onPricesChanged={handlePricesChanged}
        onReceiptDeleted={(saleId, receiptId) => {
          const update = (record: SaleRecord | null) => {
            if (!record || record.id !== saleId) return record;
            const receipts = record.receipts.filter(
              (receipt) => receipt.id !== receiptId,
            );
            return {
              ...record,
              receivedTotalCents: saleReceiptIncome({ ...record, receipts })
                .receivedTotalCents,
              receivedDifferenceCents: saleReceiptIncome({
                ...record,
                receipts,
              }).receivedDifferenceCents,
              receipts,
              reconciliation: deriveReceiptReconciliation(
                receipts,
                saleReceiptIncome(record).receiptTargetCents,
              ),
            };
          };
          // Confirmed deletion is reflected immediately, even if the list
          // refresh fails. Unrelated drafts in the keyed editor stay intact.
          setPage((current) => ({
            ...current,
            items: current.items.map((record) => update(record)!),
          }));
          setEditSale(update);
          setDetailSale(update);
          setReportSale(update);
        }}
        onChanged={async () => {
          analyticsCacheRef.current.clear();
          listDataKeyRef.current = '';
          setAnalyticsState(null);
          await loadSales(null, false, true);
          window.dispatchEvent(new Event('pdv:sales-changed'));
          void onChanged();
        }}
        onOpenChange={(open) => {
          if (!open) {
            setEditSale(null);
            if (returnToPeriodReport) {
              setReturnToPeriodReport(false);
              setPeriodReportOpen(true);
            }
          }
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
          if (!open) {
            setCancelSale(null);
            if (returnToPeriodReport) {
              setReturnToPeriodReport(false);
              setPeriodReportOpen(true);
            }
          }
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
  onDetails,
}: {
  sales: SaleRecord[];
  onDetails: (sale: SaleRecord) => void;
}) {
  return (
    <div className="grid gap-1.5 bg-muted/20 p-1.5 sm:gap-2 sm:p-2">
      {sales.map((sale) => {
        const financial = saleFinancialSummary(sale);
        return (
          <button
            key={sale.id}
            type="button"
            aria-label={`Abrir detalhes da venda ${sale.number}, ${sale.customerName}`}
            onClick={() => onDetails(sale)}
            className={cn(
              'w-full rounded-xl border bg-card px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-secondary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              sale.status === 'cancelled' &&
                'bg-muted/40 text-muted-foreground',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-base font-bold">
                  <span
                    className={cn(
                      'shrink-0 text-lg font-extrabold tabular-nums',
                      sale.status !== 'cancelled' && 'text-primary',
                    )}
                  >
                    #{String(sale.number).padStart(5, '0')}
                  </span>
                  <span
                    className="min-w-0 max-w-full truncate"
                    title={sale.customerName}
                  >
                    {sale.customerName}
                  </span>
                </p>
                <p
                  className="mt-0.5 line-clamp-2 text-sm text-muted-foreground"
                  title={sale.items
                    .map(
                      (item) => `${item.productName} · ${item.productDetail}`,
                    )
                    .join('; ')}
                >
                  {sale.items.length}{' '}
                  {sale.items.length === 1 ? 'aparelho' : 'aparelhos'} ·{' '}
                  {sale.items[0]?.productName ?? 'Produto'}
                  {sale.items[0]?.productDetail
                    ? ` · ${sale.items[0].productDetail}`
                    : ''}
                  {sale.items.length > 1 ? ` +${sale.items.length - 1}` : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={cn(
                    'text-base font-extrabold tabular-nums',
                    financial.reconciled && 'text-success',
                  )}
                >
                  {formatMoney(sale.productsTotalCents)}
                </p>
                {sale.status === 'cancelled' ? (
                  <p className="text-sm text-muted-foreground">
                    {financial.paymentLabel}
                  </p>
                ) : financial.pixCents > 0 || financial.cashCents > 0 ? (
                  <div className="text-sm font-semibold tabular-nums text-success">
                    {financial.pixCents > 0 && (
                      <p>Recebido Pix {formatMoney(financial.pixCents)}</p>
                    )}
                    {financial.cashCents > 0 && (
                      <p>
                        Recebido Dinheiro {formatMoney(financial.cashCents)}
                      </p>
                    )}
                  </div>
                ) : null}
                {sale.status === 'completed' &&
                  sale.receivedDifferenceCents !== 0 && (
                    <p
                      className={cn(
                        'mt-0.5 text-sm font-semibold tabular-nums',
                        sale.receivedDifferenceCents < 0
                          ? 'text-destructive'
                          : 'text-amber-800 dark:text-amber-200',
                      )}
                    >
                      {paymentDifferenceText(sale)}
                    </p>
                  )}
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <p className="text-xs text-muted-foreground">
                {formatDateTime(sale.createdAt)} · {sale.sellerName}
              </p>
              <span className="flex items-center gap-1.5">
                <SaleStatusBadge sale={sale} />
              </span>
            </div>
            <SaleIssuesNotice
              issueKeys={saleIssues(sale).map((issue) => issue.key)}
              compact
            />
            {!financial.reconciled && financial.receiptText && (
              <p
                className={cn(
                  'mt-1 text-sm tabular-nums',
                  financial.receiptWarning
                    ? 'font-semibold text-amber-800 dark:text-amber-200'
                    : 'text-muted-foreground',
                )}
              >
                {financial.receiptText}
              </p>
            )}
            {sale.status === 'completed' &&
              financial.pixCents > 0 &&
              !sale.receipts.length && (
                <p className="mt-1 truncate text-xs font-semibold text-amber-800 dark:text-amber-200">
                  Sem comprovante
                </p>
              )}
          </button>
        );
      })}
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
      {rows.map((row) => {
        const position =
          grouping === 'seller'
            ? ranking === 'items'
              ? row.rankByItems
              : row.rankByValue
            : null;
        const award =
          position === 1
            ? 'Ouro'
            : position === 2
              ? 'Prata'
              : position === 3
                ? 'Bronze'
                : null;
        return (
          <button
            className={cn(
              'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-l-2 border-l-transparent px-4 py-4 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5',
              award === 'Ouro' && 'border-l-amber-500 bg-amber-500/[0.045]',
              award === 'Prata' && 'border-l-slate-400 bg-slate-400/[0.045]',
              award === 'Bronze' && 'border-l-orange-700 bg-orange-700/[0.035]',
            )}
            key={row.key}
            onClick={() => onOpen(row)}
            type="button"
          >
            <span
              className={cn(
                'grid size-11 place-items-center rounded-xl bg-secondary text-primary',
                award === 'Ouro' &&
                  'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
                award === 'Prata' &&
                  'bg-slate-100 text-slate-500 dark:bg-slate-400/15 dark:text-slate-300',
                award === 'Bronze' &&
                  'bg-orange-100/70 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300',
              )}
            >
              {award ? (
                <Trophy
                  className="size-6 fill-current/15"
                  aria-label={`Troféu de ${award.toLowerCase()}`}
                />
              ) : grouping === 'model' ? (
                <Smartphone className="size-5" />
              ) : (
                <UserRound className="size-5" />
              )}
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                {grouping === 'seller' && (
                  <Badge variant="secondary">
                    {position}º{award ? ` · ${award}` : ''}
                  </Badge>
                )}
                <p className="truncate font-bold">{row.label}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {row.saleCount} {row.saleCount === 1 ? 'venda' : 'vendas'} ·{' '}
                {row.itemCount} {row.itemCount === 1 ? 'aparelho' : 'aparelhos'}
              </p>
              <p className="mt-0.5 text-xs font-semibold text-primary">
                Ver vendas e SNs
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Vendido
              </p>
              <strong>{formatMoney(row.totalCents)}</strong>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function EditSaleDialog({
  sale,
  data,
  onOpenChange,
  onChanged,
  onReceiptDeleted,
  onPricesChanged,
}: {
  sale: SaleRecord | null;
  data: BootstrapData;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
  onReceiptDeleted: (saleId: string, receiptId: string) => void;
  onPricesChanged: (saleId: string, value: SalePrices) => void;
}) {
  const canPayments = can(data.user, 'sales.payments');
  const canAttachments = can(data.user, 'sales.attachments');
  const canReceipts = can(data.user, 'sales.receipts');
  const canDeleteReceipts = can(data.user, 'sales.receipts.delete');
  const [priceEditorOpen, setPriceEditorOpen] = useState(false);
  const deletedReceiptIds = useRef(new Set<string>());
  const [deletedReceipts, setDeletedReceipts] = useState(new Set<string>());
  const activeReceipts = (sale?.receipts ?? []).filter(
    (receipt) => !deletedReceipts.has(receipt.id),
  );
  const canParticipants =
    can(data.user, 'sales.participants') && sale?.status === 'completed';
  const participants = useSaleParticipants(
    sale?.id,
    canParticipants,
    data.csrfToken,
  );
  const initialStatusId =
    sale?.orderStatus && !isAutomaticStatusName(sale.orderStatus.name)
      ? sale.orderStatus.id
      : '';
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
  // Keep precedence across partial saves and lost responses, not only this click.
  const preserveReceiptPaymentRef = useRef(new Set<string>());
  const dirtyReceiptIds = useRef(new Set<string>());
  const [dirtyReceipts, setDirtyReceipts] = useState(new Set<string>());
  const serverReceipts = useServerReceiptJobs(sale?.id, (jobs) => {
    setSavedReceiptValues((current) => {
      const next = { ...current };
      for (const row of jobs)
        if (
          !dirtyReceiptIds.current.has(row.id) &&
          !deletedReceiptIds.current.has(row.id)
        )
          next[row.id] = { amountCents: row.amountCents, source: row.source };
      return next;
    });
  });
  const attachmentOperationIdRef = useRef(createOperationId());
  const [itemFiles, setItemFiles] = useState<Record<string, File[]>>({});
  const [preparing, setPreparing] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const paymentMethod = paymentAmount.trim() ? 'cash' : '';
  const paymentOperationIdRef = useRef(createOperationId());
  const [queuedPayments, setQueuedPayments] = useState<QueuedPayment[]>([]);
  const [visiblePayments, setVisiblePayments] = useState<SalePaymentRecord[]>(
    () => sale?.payments ?? [],
  );
  const [paymentEdits, setPaymentEdits] = useState<
    Record<
      string,
      {
        method: 'pix' | 'cash';
        pixAccountId: string | null;
        amount: string;
      }
    >
  >({});
  const paymentCorrectionIdRef = useRef(createOperationId());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!sale || uploadBusy) return;
    const timer = window.setTimeout(() => {
      if (Object.keys(paymentEdits).length === 0)
        setVisiblePayments(sale.payments);
      setSavedReceiptValues((current) => {
        const next = { ...current };
        for (const receipt of sale.receipts)
          if (
            !dirtyReceiptIds.current.has(receipt.id) &&
            !deletedReceiptIds.current.has(receipt.id)
          ) {
            next[receipt.id] = {
              amountCents: receipt.receiptAmountCents,
              source: receipt.receiptAmountSource,
            };
          }
        return next;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sale, uploadBusy, paymentEdits]);

  const existingAttachmentCount = sale
    ? activeReceipts.length +
      sale.items.reduce((total, item) => total + item.photos.length, 0)
    : 0;
  const existingAttachmentBytes = sale
    ? activeReceipts.reduce((total, file) => total + file.sizeBytes, 0) +
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
    (status) =>
      (status.active || status.id === currentStatusId) &&
      !isAutomaticStatusName(status.name),
  );
  const additionalPaymentCents = parseMoneyInput(paymentAmount);
  const correctedPayments = visiblePayments.map((payment) => {
    const edit = paymentEdits[payment.id];
    return {
      id: payment.id,
      method: edit?.method ?? payment.method,
      pixAccountId: edit
        ? edit.method === 'pix'
          ? edit.pixAccountId
          : null
        : payment.pixAccountId,
      amountCents: edit ? parseMoneyInput(edit.amount) : payment.amountCents,
    };
  });
  const hasPaymentCorrections = correctedPayments.some((payment, index) => {
    const saved = visiblePayments[index];
    return (
      payment.method !== saved.method ||
      payment.pixAccountId !== saved.pixAccountId ||
      payment.amountCents !== saved.amountCents
    );
  });
  const invalidPaymentCorrection = correctedPayments.some(
    (payment) =>
      payment.amountCents <= 0 || payment.amountCents > 1_000_000_000 || false,
  );
  const correctedReceivedCents = saleReceiptIncome({
    productsTotalCents: sale?.productsTotalCents ?? 0,
    payments: correctedPayments,
    receipts: activeReceipts.map((r) => ({
      ...r,
      receiptAmountCents:
        savedReceiptValues[r.id]?.amountCents ?? r.receiptAmountCents,
    })),
  }).receivedTotalCents;
  const pendingPaymentCents = Math.max(
    0,
    (sale?.productsTotalCents ?? 0) - correctedReceivedCents,
  );
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
    additionalPaymentCents <= remainingPaymentCents;
  const changedSavedReceiptValues = activeReceipts.flatMap((receipt) => {
    if (!dirtyReceipts.has(receipt.id)) return [];
    const value = savedReceiptValues[receipt.id] ?? {
      amountCents: null,
      source: null,
    };
    return value.amountCents !== receipt.receiptAmountCents ||
      value.source !== receipt.receiptAmountSource
      ? [{ id: receipt.id, ...value }]
      : [];
  });
  const draftCashCents = paymentMethodTotals([
    ...correctedPayments,
    ...queuedPayments,
    ...(paymentReady
      ? [{ method: paymentMethod, amountCents: additionalPaymentCents }]
      : []),
  ]).cashCents;
  const draftPixCents = Math.max(
    0,
    (sale?.productsTotalCents ?? 0) - draftCashCents,
  );
  const reconciliation = sale
    ? deriveReceiptReconciliation(
        [
          ...activeReceipts.map(
            (receipt) =>
              savedReceiptValues[receipt.id] ?? {
                amountCents: receipt.receiptAmountCents,
                source: receipt.receiptAmountSource,
              },
          ),
          ...receiptValues,
        ],
        draftPixCents,
      )
    : null;

  const currentPaymentDraft = (): QueuedPayment | null => {
    if (!paymentReady || !paymentMethod) return null;
    return {
      operationId: paymentOperationIdRef.current,
      method: 'cash',
      pixAccountId: null,
      accountName: null,
      amountCents: additionalPaymentCents,
    };
  };

  const queueCurrentPayment = () => {
    const draft = currentPaymentDraft();
    if (!draft) return;
    setQueuedPayments((current) => [...current, draft]);
    setPaymentAmount('');
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
        maxFiles: Math.max(
          0,
          MEDIA_LIMITS.saleReceipts - activeReceipts.length,
        ),
        allowPdf: true,
        maxDimension: 1_920,
        quality: 0.8,
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
                acrescente anexos. Com permissão, também troque cliente e
                vendedor e corrija os preços desta venda. Produtos e SNs
                permanecem protegidos.
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
                    <h3 className="font-extrabold">Status da venda</h3>
                    <p className="text-xs text-muted-foreground">
                      Conciliado e Cancelado são automáticos. Os demais são
                      escolhidos pela equipe.
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-3">
                  <SaleStatusBadge sale={sale} />
                  <SaleIssuesNotice
                    issueKeys={saleIssues(sale).map((issue) => issue.key)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Conciliação compara os valores cadastrados; não confirma o
                    crédito no banco.
                  </p>
                  <label
                    className="block text-sm font-semibold"
                    htmlFor="sale-custom-status"
                  >
                    Status cadastrado
                  </label>
                  <NativeSelect
                    id="sale-custom-status"
                    aria-label="Status cadastrado desta venda"
                    disabled={!can(data.user, 'sales.status') || uploadBusy}
                    className="h-11 w-full [&_select]:h-11"
                    onChange={(event) =>
                      setSelectedStatusId(event.target.value)
                    }
                    value={selectedStatusId}
                  >
                    <NativeSelectOption value="">
                      Sem status escolhido
                    </NativeSelectOption>
                    {availableStatuses.map((status) => (
                      <NativeSelectOption key={status.id} value={status.id}>
                        {status.name}
                        {status.active ? '' : ' (inativo)'}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {automaticSaleStatus(sale) && (
                    <p className="text-sm text-muted-foreground">
                      {automaticSaleStatus(sale)!.label} prevalece enquanto a
                      conferência estiver completa. O status escolhido fica
                      guardado, sem alterar pagamentos.
                    </p>
                  )}
                </div>
                {selectedStatusId !== currentStatusId && (
                  <p className="mt-2 text-xs font-semibold text-primary">
                    O status escolhido será salvo ao confirmar as alterações.
                  </p>
                )}
                {data.orderStatuses.length === 0 && (
                  <p className="mt-2 text-xs font-semibold text-amber-800">
                    Cadastre os demais status em Configurações › Financeiro ›
                    Status do pedido.
                  </p>
                )}
              </section>

              {canParticipants && (
                <SaleParticipantsEditor
                  editor={participants}
                  disabled={preparing || uploadBusy}
                />
              )}

              {can(data.user, 'sales.prices') &&
                sale.status === 'completed' && (
                  <SalePricesEditor
                    sale={sale}
                    csrfToken={data.csrfToken}
                    disabled={preparing || uploadBusy}
                    onEditingChange={setPriceEditorOpen}
                    onBusyChange={setUploadBusy}
                    onSaved={(value) => {
                      onPricesChanged(sale.id, value);
                      setNotice(
                        'Preços da venda atualizados. Os pagamentos e preços padrão foram mantidos.',
                      );
                    }}
                  />
                )}

              {canPayments && sale.status === 'completed' && (
                <section className="rounded-2xl border p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                      <WalletCards className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-extrabold">Pagamentos da venda</h3>
                      <p className="text-xs text-muted-foreground">
                        Informe ou corrija somente dinheiro. O Pix vem do valor
                        lido no comprovante, sem cadastro manual.
                      </p>
                    </div>
                  </div>

                  {(visiblePayments.length > 0 ||
                    queuedPayments.length > 0) && (
                    <div className="mt-3 space-y-1 rounded-xl bg-background/80 p-3 text-xs">
                      {visiblePayments
                        .filter((payment) => payment.method === 'cash')
                        .map((payment, index) => {
                          const edit = paymentEdits[payment.id];
                          const update = (
                            changes: Partial<NonNullable<typeof edit>>,
                          ) => {
                            paymentCorrectionIdRef.current =
                              createOperationId();
                            setPaymentEdits((current) => ({
                              ...current,
                              [payment.id]: {
                                ...(current[payment.id] ?? {
                                  method: payment.method,
                                  pixAccountId: payment.pixAccountId,
                                  amount: formatMoneyInput(payment.amountCents),
                                }),
                                ...changes,
                              },
                            }));
                          };
                          return (
                            <div
                              className="rounded-xl border p-3"
                              key={payment.id}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="min-w-0 text-sm text-muted-foreground">
                                  {payment.method === 'pix'
                                    ? `Pix${payment.accountName ? ` · ${payment.accountName}` : ''}`
                                    : 'Dinheiro'}
                                </span>
                                <strong className="ml-auto whitespace-nowrap text-sm">
                                  {formatMoney(payment.amountCents)}
                                </strong>
                                <Button
                                  disabled={uploadBusy}
                                  size="sm"
                                  variant="ghost"
                                  type="button"
                                  onClick={() => {
                                    if (edit) {
                                      paymentCorrectionIdRef.current =
                                        createOperationId();
                                      setPaymentEdits((current) => {
                                        const next = { ...current };
                                        delete next[payment.id];
                                        return next;
                                      });
                                    } else update({});
                                  }}
                                >
                                  {edit ? (
                                    'Desfazer'
                                  ) : (
                                    <>
                                      <Pencil className="size-4" /> Alterar
                                    </>
                                  )}
                                </Button>
                              </div>
                              {edit && (
                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                  <label className="text-sm font-semibold">
                                    Valor do pagamento
                                    <Input
                                      aria-label={`Valor do pagamento ${index + 1}`}
                                      className="mt-1 h-11 text-right font-bold"
                                      disabled={uploadBusy}
                                      inputMode="decimal"
                                      value={edit.amount}
                                      onChange={(event) =>
                                        update({ amount: event.target.value })
                                      }
                                    />
                                  </label>
                                  <p className="text-xs text-muted-foreground sm:col-span-2">
                                    A correção será aplicada ao salvar as
                                    alterações.
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        })}
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
                            aria-label="Remover recebimento em dinheiro"
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

                  <div
                    className="mt-3 flex flex-wrap justify-between gap-2 text-sm font-semibold"
                    aria-live="polite"
                  >
                    <span>
                      Valor da venda: {formatMoney(sale.productsTotalCents)}
                    </span>
                    <span>
                      Total pago:{' '}
                      {formatMoney(
                        correctedReceivedCents +
                          queuedPaymentCents +
                          (paymentReady ? additionalPaymentCents : 0),
                      )}
                    </span>
                  </div>
                  {invalidPaymentCorrection && (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      Informe um valor em dinheiro maior que zero.
                    </p>
                  )}
                  {queuedPaymentCents > pendingPaymentCents && (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      O dinheiro acrescentado excede o saldo após a correção.
                      Revise os recebimentos antes de salvar.
                    </p>
                  )}
                  {correctedReceivedCents > sale.productsTotalCents && (
                    <p className="mt-2 text-sm text-amber-800">
                      Pagamento acima da venda em{' '}
                      {formatMoney(
                        correctedReceivedCents - sale.productsTotalCents,
                      )}
                      .
                    </p>
                  )}

                  {remainingPaymentCents > 0 && (
                    <div className="mt-3">
                      <div>
                        <label
                          className="text-sm font-semibold"
                          htmlFor={`sale-${sale.id}-payment-amount`}
                        >
                          Adicionar recebimento em dinheiro
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
                          placeholder="Valor recebido em dinheiro"
                          onChange={(event) =>
                            setPaymentAmount(event.target.value)
                          }
                          value={paymentAmount}
                        />
                      </div>
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
                        {formatMoney(remainingPaymentCents)}.
                      </p>
                    )}
                  {remainingPaymentCents > 0 && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-muted-foreground">
                        Falta receber {formatMoney(remainingPaymentCents)}.
                      </p>
                      <Button
                        disabled={!paymentReady}
                        onClick={queueCurrentPayment}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Plus /> Adicionar dinheiro
                      </Button>
                    </div>
                  )}
                  {queuedPayments.length > 0 && remainingPaymentCents === 0 && (
                    <p className="mt-3 rounded-xl bg-success/10 px-3 py-2 text-xs font-semibold text-success">
                      Recebimento em dinheiro adicionado. Salve as alterações
                      para confirmar.
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
                        Foto, imagem ou PDF · {activeReceipts.length} de{' '}
                        {MEDIA_LIMITS.saleReceipts} já anexados
                      </p>
                    </div>
                  </div>
                  <MediaPickerButtons
                    accessibleLabel="comprovantes da venda"
                    allowPdf
                    disabled={
                      !canAttachments ||
                      preparing ||
                      uploadBusy ||
                      activeReceipts.length + receiptFiles.length >=
                        MEDIA_LIMITS.saleReceipts ||
                      remainingAttachmentCount <= selectedFiles.length
                    }
                    id={`sale-${sale.id}-receipts`}
                    onFiles={prepareReceipts}
                  />
                </div>
                {serverReceipts.error && (
                  <output className="mt-2 block text-xs text-muted-foreground">
                    {serverReceipts.error}
                  </output>
                )}
                {activeReceipts.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {activeReceipts.map((receipt) => (
                      <SavedReceiptValueEditor
                        receiptAction={
                          canDeleteReceipts && sale.status === 'completed' ? (
                            <DeleteReceiptButton
                              receipt={receipt}
                              saleId={sale.id}
                              csrfToken={data.csrfToken}
                              disabled={preparing || uploadBusy}
                              onBusyChange={setUploadBusy}
                              onDeleted={(cleanupPending) => {
                                deletedReceiptIds.current.add(receipt.id);
                                setDeletedReceipts(
                                  new Set(deletedReceiptIds.current),
                                );
                                dirtyReceiptIds.current.delete(receipt.id);
                                setDirtyReceipts(
                                  new Set(dirtyReceiptIds.current),
                                );
                                setSavedReceiptValues((current) => {
                                  const next = { ...current };
                                  delete next[receipt.id];
                                  return next;
                                });
                                receiptValueOperationIdRef.current =
                                  createOperationId();
                                setError('');
                                setNotice(
                                  cleanupPending
                                    ? 'Comprovante removido da venda. A limpeza do arquivo continuará no servidor.'
                                    : 'Comprovante excluído. A venda e os pagamentos foram mantidos.',
                                );
                                onReceiptDeleted(sale.id, receipt.id);
                                window.dispatchEvent(
                                  new Event('pdv:sales-changed'),
                                );
                                window.dispatchEvent(
                                  new Event('pdv:receipts-saved'),
                                );
                              }}
                            />
                          ) : undefined
                        }
                        serverJob={serverReceipts.jobs[receipt.id]}
                        onServerRetry={
                          dirtyReceipts.has(receipt.id) ||
                          hasPaymentCorrections ||
                          queuedPayments.length > 0
                            ? undefined
                            : () => serverReceipts.retry(receipt.id)
                        }
                        disabled={!canReceipts || preparing || uploadBusy}
                        key={receipt.id}
                        onAutoValueFound={async (value) => {
                          if (
                            !canReceipts ||
                            deletedReceiptIds.current.has(receipt.id)
                          )
                            return;
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
                        onValueChange={(value) => {
                          if (deletedReceiptIds.current.has(receipt.id)) return;
                          dirtyReceiptIds.current.add(receipt.id);
                          setDirtyReceipts(new Set(dirtyReceiptIds.current));
                          setSavedReceiptValues((current) => ({
                            ...current,
                            [receipt.id]: value,
                          }));
                        }}
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
                      cashCents={draftCashCents}
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
                      targetCents={draftPixCents}
                      values={receiptValues}
                    />
                  </>
                )}
                {reconciliation && (
                  <ReconciliationSummary
                    cashCents={draftCashCents}
                    className="mt-3"
                    reconciliation={reconciliation}
                    targetCents={draftPixCents}
                  />
                )}
                <ReceiptPaymentSync
                  saleId={sale.id}
                  productsTotalCents={sale.productsTotalCents}
                  disabled={
                    preparing ||
                    uploadBusy ||
                    hasPaymentCorrections ||
                    queuedPayments.length > 0 ||
                    paymentMethod !== '' ||
                    selectedFiles.length > 0 ||
                    changedSavedReceiptValues.length > 0
                  }
                  onPayments={(payments, total) => {
                    if (hasPaymentCorrections || uploadBusy) return false;
                    setVisiblePayments(payments);
                    if (total !== sale.receivedTotalCents) void onChanged();
                    return true;
                  }}
                />
              </section>

              <section className="rounded-2xl border p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                    <ImagePlus className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-extrabold">Fotos dos aparelhos</h3>
                    <p className="text-xs text-muted-foreground">
                      Abra o aparelho para ver ou anexar fotos pelo SN.
                    </p>
                  </div>
                </div>
                <Accordion
                  className="mt-3 overflow-hidden rounded-xl border"
                  defaultValue={
                    sale.items.length === 1 ? [sale.items[0].id] : []
                  }
                >
                  {sale.items.map((item) => {
                    const selected = itemFiles[item.id] ?? [];
                    return (
                      <AccordionItem value={item.id} key={item.id}>
                        <AccordionTrigger className="items-center gap-3 px-3 py-2.5 hover:no-underline">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-bold">
                              {item.productName}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {item.productDetail} · SN {item.serial}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 text-xs font-semibold ${item.photos.length + selected.length === 0 ? 'text-amber-800' : 'text-muted-foreground'}`}
                          >
                            {selected.length
                              ? `${selected.length} nova(s)`
                              : item.photos.length
                                ? `${item.photos.length} foto(s)`
                                : 'Sem foto'}
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="px-3 pb-3">
                          <div className="flex justify-end">
                            <MediaPickerButtons
                              accessibleLabel={`fotos do aparelho ${item.productName}, SN ${item.serial}`}
                              disabled={
                                !canAttachments ||
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
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
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
              {priceEditorOpen && (
                <output className="text-xs text-muted-foreground">
                  Salve ou cancele a edição dos preços antes de salvar as demais
                  alterações.
                </output>
              )}
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
                    priceEditorOpen ||
                    invalidPaymentCorrection ||
                    queuedPaymentCents > pendingPaymentCents ||
                    (remainingPaymentCents > 0 &&
                      paymentMethod !== '' &&
                      !paymentReady) ||
                    (selectedFiles.length === 0 &&
                      selectedStatusId === currentStatusId &&
                      changedSavedReceiptValues.length === 0 &&
                      !hasPaymentCorrections &&
                      !participants.dirty &&
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
                    let participantsSaved = false;
                    try {
                      participantsSaved = await participants.save();
                      if (hasPaymentCorrections) {
                        const corrected = await requestJson<{
                          payments: SalePaymentRecord[];
                        }>(`/api/sales/${sale.id}/payments`, {
                          method: 'PATCH',
                          headers: {
                            'content-type': 'application/json',
                            'x-csrf-token': data.csrfToken,
                          },
                          body: JSON.stringify({
                            operationId: paymentCorrectionIdRef.current,
                            expectedPayments: visiblePayments.map(
                              ({ id, method, pixAccountId, amountCents }) => ({
                                id,
                                method,
                                pixAccountId,
                                amountCents,
                              }),
                            ),
                            payments: correctedPayments,
                          }),
                        });
                        paymentSaved = true;
                        preserveReceiptPaymentRef.current.add(
                          receiptValueOperationIdRef.current,
                        );
                        preserveReceiptPaymentRef.current.add(
                          attachmentOperationIdRef.current,
                        );
                        setVisiblePayments(corrected.payments);
                        setPaymentEdits({});
                        paymentCorrectionIdRef.current = createOperationId();
                      }
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
                        preserveReceiptPaymentRef.current.add(
                          receiptValueOperationIdRef.current,
                        );
                        preserveReceiptPaymentRef.current.add(
                          attachmentOperationIdRef.current,
                        );
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
                        setPaymentAmount('');
                      }
                      if (paymentsToSave.length > 0) {
                        setPaymentAmount('');
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
                        changedSavedReceiptValues.forEach((receipt) =>
                          dirtyReceiptIds.current.delete(receipt.id),
                        );
                        setDirtyReceipts(new Set(dirtyReceiptIds.current));
                      }
                      if (selectedFiles.length > 0) {
                        const form = new FormData();
                        form.set(
                          'operationId',
                          attachmentOperationIdRef.current,
                        );
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
                          replayed?: boolean;
                        }>(`/api/sales/${sale.id}/attachments`, {
                          method: 'POST',
                          headers: { 'x-csrf-token': data.csrfToken },
                          body: form,
                        });
                        window.dispatchEvent(new Event('pdv:receipts-saved'));
                        if (!data.serverReceiptOcr)
                          void enqueueReceiptOcrJobs({
                            userId: data.user.id,
                            attachments: attachmentResult.receipts ?? [],
                            files: attachmentResult.replayed
                              ? undefined
                              : receiptFiles,
                            receiptValues: attachmentResult.replayed
                              ? undefined
                              : receiptValues,
                            saleId: sale.id,
                            storeId: data.store.id,
                          }).catch(() => {});
                        attachmentsSaved = true;
                      }
                      await onChanged();
                      if (
                        canPayments &&
                        canReceipts &&
                        (receiptFiles.length > 0 || receiptValuesSaved) &&
                        ![...correctedPayments, ...paymentsToSave].some(
                          (payment) => payment.method === 'pix',
                        )
                      ) {
                        setReceiptFiles([]);
                        setReceiptValues([]);
                        setItemFiles({});
                        setPaymentEdits({});
                        attachmentOperationIdRef.current = createOperationId();
                        receiptValueOperationIdRef.current =
                          createOperationId();
                        setNotice(
                          'Comprovante salvo. O valor lido será somado ao dinheiro recebido e conferido com o preço da venda.',
                        );
                      } else {
                        onOpenChange(false);
                      }
                    } catch (caught) {
                      const savedParts = [
                        participantsSaved ? 'o cliente e vendedor' : '',
                        paymentSaved ? 'o pagamento' : '',
                        statusSaved ? 'o status' : '',
                        receiptValuesSaved
                          ? 'a conciliação dos comprovantes'
                          : '',
                        attachmentsSaved ? 'os anexos' : '',
                      ].filter(Boolean);
                      // Reabra com valores atuais também depois de um conflito,
                      // mesmo que nenhuma parte desta tentativa tenha sido salva.
                      await onChanged();
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
  const paymentSummary = useMemo(
    () => summarizeSalesPayments(sale ? [sale] : []),
    [sale],
  );
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
                PDF com diagramação própria, texto nítido e anexos
                identificados.
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
                  <div className="mt-2">
                    <SaleStatusBadge sale={sale} />
                    <SaleIssuesNotice
                      issueKeys={saleIssues(sale).map((issue) => issue.key)}
                    />
                  </div>
                </header>
                <section className="report-section mt-4">
                  <h3 className="font-extrabold">Cliente</h3>
                  <p>{sale.customerName}</p>
                  <p className="text-sm text-slate-600">
                    Vendedor: {sale.sellerName}
                  </p>
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
                                  decoding="async"
                                  loading="lazy"
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
                {
                  <section className="report-section mt-5">
                    <h3 className="font-extrabold">Pagamentos recebidos</h3>
                    <div className="mt-2 space-y-2">
                      {sale.payments.length === 0 ? (
                        <div className="report-row rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
                          Pagamento não informado — pendente
                        </div>
                      ) : (
                        receiptDrivenPayments(sale).map((payment) => (
                          <div
                            className="report-row flex justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            key={payment.id}
                          >
                            <span>
                              {payment.method === 'pix'
                                ? `Pix · ${payment.recipientName || 'Recebedor não identificado'}`
                                : 'Dinheiro'}
                            </span>
                            <strong>{formatMoney(payment.amountCents)}</strong>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                }
                <ReceiptPaymentDetails receipts={sale.receipts} />
                {sale.status === 'completed' && (
                  <SalesReportPayments summary={paymentSummary} />
                )}
                {sale.status === 'completed' && (
                  <div
                    className={cn(
                      'report-section mt-3 rounded-lg border px-3 py-2 text-sm font-semibold',
                      getPaymentComparison(sale) === 'under' &&
                        'border-rose-200 bg-rose-50 text-rose-950',
                      saleFinancialSummary(sale).reconciled &&
                        'border-emerald-200 bg-emerald-50 text-emerald-950',
                      getPaymentComparison(sale) === 'equal' &&
                        !saleFinancialSummary(sale).reconciled &&
                        'border-amber-200 bg-amber-50 text-amber-950',
                      getPaymentComparison(sale) === 'over' &&
                        'border-violet-200 bg-violet-50 text-violet-950',
                      getPaymentComparison(sale) === 'unset' &&
                        'border-slate-200 bg-slate-50 text-slate-800',
                    )}
                  >
                    <SaleStatusBadge sale={sale} />
                    <p className="mt-1">
                      Valor da venda: {formatMoney(sale.productsTotalCents)}
                      {' · '}Total pago: {formatMoney(sale.receivedTotalCents)}
                    </p>
                    {sale.receivedDifferenceCents !== 0 && (
                      <p className="mt-1 font-extrabold">
                        {paymentDifferenceText(sale)}
                      </p>
                    )}
                  </div>
                )}
                <div
                  className={cn(
                    'report-section mt-3 rounded-lg border px-3 py-2 text-sm',
                    saleFinancialSummary(sale).reconciled &&
                      'border-emerald-200 bg-emerald-50 text-emerald-950',
                    sale.reconciliation.status === 'pending' &&
                      'border-amber-200 bg-amber-50 text-amber-950',
                    sale.reconciliation.status === 'divergent' &&
                      'border-rose-200 bg-rose-50 text-rose-950',
                  )}
                >
                  <p className="font-extrabold">
                    {sale.reconciliation.status === 'not_required'
                      ? 'Sem Pix — comprovante não exigido'
                      : sale.reconciliation.status === 'reconciled'
                        ? 'Comprovantes conferem com o Pix'
                        : sale.reconciliation.status === 'divergent'
                          ? 'Comprovantes não conferem'
                          : 'Conciliação pendente'}
                  </p>
                  <p className="mt-0.5">
                    Comprovantes confirmados:{' '}
                    {formatMoney(sale.reconciliation.confirmedTotalCents)} ·{' '}
                    {receiptTargetLabel(saleReceiptIncome(sale).cashCents)}:{' '}
                    {formatMoney(saleReceiptIncome(sale).receiptTargetCents)}
                    {sale.reconciliation.status === 'divergent'
                      ? ` · Diferença: ${formatMoney(Math.abs(sale.reconciliation.differenceCents ?? 0))} ${(sale.reconciliation.differenceCents ?? 0) < 0 ? 'abaixo' : 'acima'} do ${receiptTargetLabel(saleReceiptIncome(sale).cashCents)}`
                      : ''}
                  </p>
                </div>
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
                              decoding="async"
                              loading="lazy"
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
                      {saleDisplayStatus(sale).label}
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
                    const { downloadSalesReportPdf } =
                      await import('@/lib/sales-report-pdf');
                    await downloadSalesReportPdf({
                      storeName,
                      sales: [sale],
                      level,
                      singleSale: true,
                      includePhotos,
                      includeReceipts,
                      fileName: `venda-${String(sale.number).padStart(5, '0')}-${dateKey(sale.createdAt)}`,
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
  storeId,
  initialLevel = 'simple',
  onOpenSale,
}: {
  open: boolean;
  storeName: string;
  filterParams: string;
  filterSummary: string;
  period: PeriodFilter;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  initialLevel?: ReportLevel;
  onOpenSale: (sale: SaleRecord) => void;
}) {
  const [level, setLevel] = useState<ReportLevel>(initialLevel);
  const [link, setLink] = useState('');
  const [linkNotice, setLinkNotice] = useState('');
  const [linkSignature, setLinkSignature] = useState('');
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
    const refresh = () => setLoadRevision((value) => value + 1);
    window.addEventListener('pdv:sales-changed', refresh);
    return () => window.removeEventListener('pdv:sales-changed', refresh);
  }, [open]);

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
  const paymentSummary = useMemo(() => summarizeSalesPayments(sales), [sales]);
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
    (sale) => saleIssues(sale).length > 0,
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
            Conferência online ou PDF, com vendas e anexos identificados.
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
                  <dt className="text-xs font-black uppercase tracking-[.1em] text-emerald-50/90">
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

              <SalesReportPayments summary={paymentSummary} />

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
                            <p className="text-xs font-black uppercase tracking-[.1em] text-blue-200">
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
                                saleFinancialSummary(sale).reconciled &&
                                  'border-emerald-300 bg-emerald-50/30',
                                sale.status === 'completed' &&
                                  !saleFinancialSummary(sale).reconciled &&
                                  'border-amber-300 bg-amber-50/30',
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
                                        : saleFinancialSummary(sale).reconciled
                                          ? 'bg-emerald-100/80'
                                          : 'bg-amber-50',
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
                                  <div className="mt-2">
                                    <SaleStatusBadge sale={sale} />
                                    <SaleIssuesNotice
                                      issueKeys={saleIssues(sale).map(
                                        (issue) => issue.key,
                                      )}
                                    />
                                  </div>
                                  {saleFinancialSummary(sale).receiptText && (
                                    <p
                                      className={cn(
                                        'mt-1 text-xs font-semibold',
                                        saleFinancialSummary(sale)
                                          .receiptWarning
                                          ? 'text-amber-900'
                                          : 'text-slate-600',
                                      )}
                                    >
                                      {saleFinancialSummary(sale).receiptText}
                                    </p>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="mt-2"
                                    onClick={() => onOpenSale(sale)}
                                    data-report-controls
                                  >
                                    Abrir venda
                                  </Button>
                                </div>

                                {sale.status === 'cancelled' ? (
                                  <strong className="rounded-full bg-slate-700 px-3 py-1 text-center text-xs text-white sm:justify-self-end">
                                    Cancelada
                                  </strong>
                                ) : (
                                  <div className="sm:min-w-64">
                                    <PaymentComparisonLabel
                                      className="mb-1 justify-start sm:justify-end"
                                      comparison={getPaymentComparison(sale)}
                                      surface="report"
                                    />
                                    <dl className="grid grid-cols-2 gap-2">
                                      <div className="rounded-lg bg-white/80 px-2 py-2">
                                        <dt className="text-xs font-black uppercase tracking-wide text-slate-500">
                                          Valor da venda
                                        </dt>
                                        <dd className="mt-0.5 break-words text-sm font-extrabold">
                                          {formatMoney(sale.productsTotalCents)}
                                        </dd>
                                      </div>
                                      <div className="rounded-lg bg-white/80 px-2 py-2">
                                        <dt className="text-xs font-black uppercase tracking-wide text-slate-500">
                                          Total pago
                                        </dt>
                                        <dd className="mt-0.5 break-words text-sm font-extrabold">
                                          {formatMoney(sale.receivedTotalCents)}
                                        </dd>
                                      </div>
                                    </dl>
                                  </div>
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
                                      receiptDrivenPayments(sale).map(
                                        (payment) => (
                                          <p
                                            className="mt-1 flex justify-between gap-3"
                                            key={payment.id}
                                          >
                                            <span>
                                              {payment.method === 'pix'
                                                ? `Pix · ${payment.recipientName || 'Recebedor não identificado'}`
                                                : 'Dinheiro'}
                                            </span>
                                            <strong>
                                              {formatMoney(payment.amountCents)}
                                            </strong>
                                          </p>
                                        ),
                                      )
                                    )}
                                    <ReceiptPaymentDetails
                                      receipts={sale.receipts}
                                    />
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
                                        'not_required'
                                          ? 'Sem Pix — comprovante não exigido'
                                          : sale.reconciliation.status ===
                                              'reconciled'
                                            ? 'Comprovantes conferem com o Pix'
                                            : sale.reconciliation.status ===
                                                'divergent'
                                              ? 'Comprovantes não conferem'
                                              : 'Conciliação pendente'}
                                      </p>
                                      <p>
                                        Comprovantes:{' '}
                                        {formatMoney(
                                          sale.reconciliation
                                            .confirmedTotalCents,
                                        )}{' '}
                                        ·{' '}
                                        {receiptTargetLabel(
                                          saleReceiptIncome(sale).cashCents,
                                        )}
                                        :{' '}
                                        {formatMoney(
                                          saleReceiptIncome(sale)
                                            .receiptTargetCents,
                                        )}
                                        {sale.reconciliation.status ===
                                        'divergent'
                                          ? ` · Diferença: ${formatMoney(Math.abs(sale.reconciliation.differenceCents ?? 0))} ${(sale.reconciliation.differenceCents ?? 0) < 0 ? 'abaixo' : 'acima'} do ${receiptTargetLabel(saleReceiptIncome(sale).cashCents)}`
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
                                                    decoding="async"
                                                    loading="lazy"
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
                                                    decoding="async"
                                                    loading="lazy"
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
          className="m-0 shrink-0 rounded-none border-t bg-background p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] sm:flex-wrap"
          data-report-controls
        >
          {link && linkSignature === `${level}:${filterParams}` && (
            <div className="w-full min-w-0 text-left sm:basis-full">
              <Input
                aria-label="Link do relatório"
                readOnly
                value={link}
                onFocus={(event) => event.target.select()}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {linkNotice} Somente usuários autorizados da loja. Mostra dados
                atualizados; períodos relativos acompanham a data de abertura.
              </p>
            </div>
          )}
          <Button
            variant="outline"
            disabled={loading || pdfBusy}
            onClick={() => setLoadRevision((value) => value + 1)}
          >
            <RefreshCw /> Atualizar
          </Button>
          <Button
            variant="outline"
            disabled={loading || Boolean(loadError) || pdfBusy}
            onClick={async () => {
              try {
                const url = new URL(
                  salesReportPath(storeId, level, filterParams),
                  window.location.origin,
                ).toString();
                setLink(url);
                setLinkSignature(`${level}:${filterParams}`);
                try {
                  await navigator.clipboard.writeText(url);
                  setLinkNotice('Link copiado.');
                } catch {
                  setLinkNotice('Selecione o campo acima para copiar.');
                }
              } catch (error) {
                setPdfError(messageOf(error));
              }
            }}
          >
            <Link2 /> Copiar link
          </Button>
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
                const { downloadSalesReportPdf } =
                  await import('@/lib/sales-report-pdf');
                await downloadSalesReportPdf({
                  storeName,
                  sales,
                  level,
                  filterSummary,
                  generatedAt,
                  fileName: `relatorio-vendas-${dateKey(Date.now())}-${reportName(level)}`,
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
  const operationIdRef = useRef(createOperationId());
  useEffect(() => {
    operationIdRef.current = createOperationId();
  }, [sale?.id]);
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
                      body: JSON.stringify({
                        operationId: operationIdRef.current,
                        reason,
                      }),
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

type PaymentComparison = 'cancelled' | 'equal' | 'over' | 'under' | 'unset';

function getPaymentComparison(sale: SaleRecord): PaymentComparison {
  if (sale.status === 'cancelled') return 'cancelled';
  if (sale.productsTotalCents <= 0) return 'unset';
  if (sale.receivedDifferenceCents < 0) return 'under';
  if (sale.receivedDifferenceCents > 0) return 'over';
  return 'equal';
}

function PaymentComparisonLabel({
  comparison,
  className,
  surface = 'app',
}: {
  comparison: PaymentComparison;
  className?: string;
  surface?: 'app' | 'report';
}) {
  if (comparison === 'equal') return null;

  const Icon =
    comparison === 'under'
      ? ArrowDown
      : comparison === 'over'
        ? ArrowUp
        : CircleAlert;
  const text =
    comparison === 'under'
      ? 'Pago abaixo da venda'
      : comparison === 'over'
        ? 'Pago acima da venda'
        : comparison === 'cancelled'
          ? 'Venda cancelada'
          : 'Valor não definido';

  return (
    <p
      className={cn(
        'flex items-center justify-end gap-1 text-xs font-black uppercase tracking-wide',
        comparison === 'under' &&
          (surface === 'report'
            ? 'text-rose-800'
            : 'text-rose-700 dark:text-rose-300'),
        comparison === 'over' &&
          (surface === 'report'
            ? 'text-amber-800'
            : 'text-amber-700 dark:text-amber-300'),
        (comparison === 'unset' || comparison === 'cancelled') &&
          (surface === 'report'
            ? 'text-slate-700'
            : 'text-slate-600 dark:text-slate-300'),
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {text}
    </p>
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
}) {
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
        'gap-0 overflow-hidden rounded-lg border-border/80 bg-card py-0 transition-all sm:h-full sm:rounded-xl',
        onClick && 'hover:border-primary/45 hover:bg-secondary/35',
        active && 'border-primary ring-2 ring-primary/25',
      )}
      size="sm"
    >
      <CardContent className="p-1.5 sm:p-2">
        <p className="truncate text-xs font-black uppercase tracking-[-.02em] text-muted-foreground sm:tracking-[.08em]">
          <span className="sm:hidden">{mobileLabel ?? label}</span>
          <span className="hidden sm:inline">{label}</span>
        </p>
        <p
          className="mt-0.5 truncate text-sm font-black tracking-[-.045em] sm:mt-0.5 sm:text-lg sm:tracking-[-.035em]"
          title={value}
        >
          <span className="sm:hidden">{mobileValue ?? value}</span>
          <span className="hidden sm:inline">{value}</span>
        </p>
        {comparisonText && (
          <>
            <p
              className={cn(
                'mt-0.5 truncate text-xs font-extrabold leading-none sm:hidden',
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
  value,
}: {
  'aria-label': string;
  onValueChange: (value: T) => void;
  options: Array<FilterOption<T>>;
  value: T;
}) {
  const selected = options.find((option) => option.value === value);

  return (
    <Select
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      value={value}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className="h-10 w-full rounded-xl bg-background px-3 text-left font-extrabold tracking-[-.01em] shadow-sm focus-visible:ring-2"
        size="lg"
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
            className="min-h-14 rounded-xl px-3 py-2.5 pr-9 focus:bg-accent data-selected:bg-primary/10 data-selected:text-primary"
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
      <dt className="truncate text-xs font-bold uppercase text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-extrabold sm:text-lg">
        {value}
      </dd>
    </div>
  );
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
