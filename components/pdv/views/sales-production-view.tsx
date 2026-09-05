'use client';

/* oxlint-disable next/no-img-element, jsx-a11y/label-has-associated-control -- report media is authenticated and the custom textarea is wrapped by its label */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  FileCheck2,
  FileText,
  LoaderCircle,
  Printer,
  Search,
  Smartphone,
  UserRound,
  WalletCards,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import { messageOf, requestJson } from '@/lib/client-api';
import type {
  BootstrapData,
  SaleRecord,
  SalesGroupRecord,
  SalesPage,
} from '@/lib/pdv-types';

type DayFilter = 'today' | 'yesterday' | 'all' | 'custom';
type Grouping = 'sale' | 'model' | 'customer';
type ReportLevel = 'simple' | 'detailed' | 'complete';

export function SalesProductionView({
  data,
  onChanged,
}: {
  data: BootstrapData;
  onChanged: () => Promise<void>;
}) {
  const [dayAnchor, setDayAnchor] = useState(() => Date.now());
  const [query, setQuery] = useState('');
  const [dayFilter, setDayFilter] = useState<DayFilter>('today');
  const [customDay, setCustomDay] = useState(() => dateKey(dayAnchor));
  const [grouping, setGrouping] = useState<Grouping>('sale');
  const [reportSale, setReportSale] = useState<SaleRecord | null>(null);
  const [cancelSale, setCancelSale] = useState<SaleRecord | null>(null);
  const [page, setPage] = useState<SalesPage>({
    items: [],
    groups: [],
    nextCursor: null,
    total: 0,
    aggregates: { amountCents: 0, itemCount: 0, alertCount: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const requestIdRef = useRef(0);
  const today = dateKey(dayAnchor);
  const yesterday = dateKey(dayAnchor - 24 * 60 * 60 * 1000);
  const canCancel = data.user.role === 'owner' || data.user.role === 'admin';

  const loadSales = useCallback(
    async (cursor: string | null = null, append = false) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setLoadError('');
      try {
        const params = new URLSearchParams({ group: grouping, limit: '50' });
        if (query.trim()) params.set('q', query.trim());
        const selectedDay =
          dayFilter === 'today'
            ? today
            : dayFilter === 'yesterday'
              ? yesterday
              : dayFilter === 'custom'
                ? customDay
                : null;
        if (selectedDay) {
          const { from, to } = dayBounds(selectedDay);
          params.set('from', String(from));
          params.set('to', String(to));
        } else {
          params.set('from', String(dayAnchor - 366 * 24 * 60 * 60 * 1000));
          params.set('to', String(dayAnchor + 24 * 60 * 60 * 1000));
        }
        if (cursor) params.set('cursor', cursor);
        const next = await requestJson<SalesPage>(
          `/api/sales?${params.toString()}`,
        );
        if (requestId !== requestIdRef.current) return;
        setPage((current) =>
          append ? { ...next, items: [...current.items, ...next.items] } : next,
        );
      } catch (error) {
        if (requestId === requestIdRef.current) setLoadError(messageOf(error));
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [customDay, dayAnchor, dayFilter, grouping, query, today, yesterday],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSales(), 250);
    return () => window.clearTimeout(timer);
  }, [loadSales]);

  useEffect(() => {
    const updateDay = () => {
      setDayAnchor(Date.now());
      void loadSales();
    };
    const interval = window.setInterval(updateDay, 60_000);
    const onVisibility = () => {
      if (!document.hidden) updateDay();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadSales]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-3 py-3 sm:px-6 sm:py-5 lg:px-10">
      <div className="mb-3 shrink-0">
        <p className="eyebrow">Comercial</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-[-.04em] sm:text-3xl">
          Vendas
        </h1>
        <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
          Filtre por dia, agrupe por modelo ou cliente e gere o relatório de
          cada venda.
        </p>
      </div>
      <div className="mb-3 grid shrink-0 grid-cols-3 gap-2">
        <Metric
          label="Montante vendido"
          value={formatMoney(page.aggregates.amountCents)}
        />
        <Metric label="Aparelhos" value={String(page.aggregates.itemCount)} />
        <Metric
          label="Com diferença"
          value={String(page.aggregates.alertCount)}
        />
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 space-y-2 border-b p-3 sm:p-4">
          <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 rounded-xl pl-9"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cliente, modelo, venda ou SN"
                value={query}
              />
            </div>
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
              {(['today', 'yesterday', 'all', 'custom'] as const).map(
                (value) => (
                  <Button
                    className="h-8 px-2 text-xs"
                    key={value}
                    onClick={() => setDayFilter(value)}
                    size="sm"
                    variant={dayFilter === value ? 'default' : 'ghost'}
                  >
                    {value === 'today'
                      ? 'Hoje'
                      : value === 'yesterday'
                        ? 'Ontem'
                        : value === 'all'
                          ? '12 meses'
                          : 'Dia'}
                  </Button>
                ),
              )}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
            {dayFilter === 'custom' && (
              <Input
                className="h-9 rounded-xl sm:w-44"
                onChange={(event) => setCustomDay(event.target.value)}
                type="date"
                value={customDay}
              />
            )}
            <div className="grid grid-cols-3 gap-1 sm:ml-auto sm:w-[25rem]">
              <Button
                className="h-9"
                onClick={() => setGrouping('sale')}
                size="sm"
                variant={grouping === 'sale' ? 'secondary' : 'ghost'}
              >
                Por venda
              </Button>
              <Button
                className="h-9"
                onClick={() => setGrouping('model')}
                size="sm"
                variant={grouping === 'model' ? 'secondary' : 'ghost'}
              >
                Por modelo
              </Button>
              <Button
                className="h-9"
                onClick={() => setGrouping('customer')}
                size="sm"
                variant={grouping === 'customer' ? 'secondary' : 'ghost'}
              >
                Por cliente
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto p-0 overscroll-contain">
          {loadError ? (
            <div className="grid min-h-52 place-items-center p-6 text-center">
              <div>
                <AlertTriangle className="mx-auto size-8 text-destructive" />
                <p className="mt-3 text-sm font-semibold text-destructive">
                  {loadError}
                </p>
                <Button className="mt-3" onClick={() => void loadSales()}>
                  Tentar novamente
                </Button>
              </div>
            </div>
          ) : loading && page.items.length === 0 && page.groups.length === 0 ? (
            <div className="grid min-h-52 place-items-center">
              <LoaderCircle className="size-7 animate-spin text-primary" />
            </div>
          ) : page.items.length === 0 && page.groups.length === 0 ? (
            <Empty
              hasAny={
                Boolean(query.trim()) || dayFilter !== 'all' || page.total > 0
              }
            />
          ) : grouping === 'sale' ? (
            <>
              <SaleList
                canCancel={canCancel}
                onCancel={setCancelSale}
                onReport={setReportSale}
                sales={page.items}
              />
              <div className="flex items-center justify-center gap-3 border-t p-3">
                <span className="text-xs text-muted-foreground">
                  {page.items.length} de {page.total}
                </span>
                {page.nextCursor && (
                  <Button
                    disabled={loading}
                    onClick={() => void loadSales(page.nextCursor, true)}
                    size="sm"
                    variant="outline"
                  >
                    {loading && <LoaderCircle className="animate-spin" />}
                    Carregar mais
                  </Button>
                )}
              </div>
            </>
          ) : (
            <GroupedList grouping={grouping} rows={page.groups} />
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
      <CancelDialog
        data={data}
        onChanged={async () => {
          await onChanged();
          await loadSales();
        }}
        onOpenChange={(open) => {
          if (!open) setCancelSale(null);
        }}
        sale={cancelSale}
      />
    </div>
  );
}

function SaleList({
  sales,
  canCancel,
  onReport,
  onCancel,
}: {
  sales: SaleRecord[];
  canCancel: boolean;
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
            <div className="flex items-center justify-between gap-2 sm:justify-end">
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
}: {
  rows: SalesGroupRecord[];
  grouping: 'model' | 'customer';
}) {
  return (
    <div className="divide-y">
      {rows.map((row) => (
        <div
          className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-4 sm:px-5"
          key={row.key}
        >
          <span className="grid size-11 place-items-center rounded-xl bg-secondary text-primary">
            {grouping === 'model' ? (
              <Smartphone className="size-5" />
            ) : (
              <UserRound className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate font-bold">{row.label}</p>
            <p className="text-xs text-muted-foreground">
              {row.saleCount} {row.saleCount === 1 ? 'venda' : 'vendas'} ·{' '}
              {row.itemCount} {row.itemCount === 1 ? 'aparelho' : 'aparelhos'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[0.65rem] font-bold uppercase tracking-wider text-muted-foreground">
              {grouping === 'model' ? 'Produtos' : 'Recebido'}
            </p>
            <strong>{formatMoney(row.totalCents)}</strong>
          </div>
        </div>
      ))}
    </div>
  );
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
                        className="rounded-lg border border-slate-200 p-3"
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
                          className="flex justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"
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
                            className="rounded-lg border border-slate-200 p-4 text-sm font-bold"
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
                  </section>
                )}
                {level === 'complete' && (
                  <section className="report-section mt-5 rounded-xl bg-slate-100 p-3 text-sm">
                    <p>
                      <strong>Vendedor:</strong> {sale.sellerName}
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
              <Button onClick={() => onOpenChange(false)} variant="outline">
                Fechar
              </Button>
              <Button onClick={() => window.print()}>
                <Printer /> Imprimir / salvar PDF
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
function dateKey(value: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}
function dayBounds(day: string) {
  const from = new Date(`${day}T00:00:00-03:00`).getTime();
  return { from, to: from + 24 * 60 * 60 * 1000 };
}
function formatDateTime(value: number) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
