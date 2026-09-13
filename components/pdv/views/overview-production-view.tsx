'use client';

import Image from 'next/image';
import {
  SaleDisplayStatusBadge,
  SaleIssuesNotice,
} from '@/components/pdv/sale-status-badge';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { PeriodFilter, localDateKey } from '@/components/pdv/period-filter';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { messageOf, requestJson } from '@/lib/client-api';
import {
  overviewComparison,
  overviewFilters,
  overviewSaleComparison,
  type OverviewFilter,
  type OverviewPage,
  type OverviewSale,
} from '@/lib/overview';
import type { SalesPeriod } from '@/lib/server/sales-filters';
import { cn } from '@/lib/utils';

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (value: number) =>
  new Date(value).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
const number = (value: number) => `#${String(value).padStart(5, '0')}`;
function SaleComparison({ sale }: { sale: OverviewSale }) {
  const state = overviewSaleComparison(sale);
  const divergent = [
    'below',
    'above',
    'sale_difference',
    'missing_price',
  ].includes(state);
  const paymentDifference = sale.receiptCents - sale.pixCents;
  const saleDifference = sale.receivedCents - sale.saleCents;
  const reconciled = sale.automaticStatus === 'reconciled';
  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        divergent || state === 'review'
          ? 'border-amber-300 border-l-4 bg-amber-50'
          : reconciled
            ? 'border-emerald-200 bg-emerald-50/70'
            : 'bg-slate-50/60',
      )}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">
            Valor da venda
          </p>
          <p className="mt-0.5 break-words text-base font-bold tabular-nums">
            {money(sale.saleCents)}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground">
            Comprovantes + dinheiro
          </p>
          <p className="mt-0.5 break-words text-base font-bold tabular-nums">
            {money(sale.receivedCents)}
          </p>
          <p className="text-xs text-muted-foreground">
            Pix recebido {money(sale.receiptCents)} · dinheiro (manual){' '}
            {money(sale.cashCents)}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground">
            Comprovantes{sale.pendingCount ? ' · parcial' : ''}
          </p>
          <p className="mt-0.5 break-words text-base font-bold tabular-nums">
            {sale.receiptCount ? money(sale.receiptCents) : '—'}
          </p>
        </div>
      </div>
      <p
        className={cn(
          'mt-2 flex flex-wrap items-center gap-1.5 text-xs font-semibold',
          divergent || state === 'review'
            ? 'text-amber-950'
            : state === 'matched'
              ? 'text-emerald-800'
              : 'text-muted-foreground',
        )}
      >
        {divergent || state === 'review' ? (
          <TriangleAlert className="size-4 shrink-0" />
        ) : state === 'matched' ? (
          <Check className="size-4 shrink-0" />
        ) : (
          <FileText className="size-4 shrink-0" />
        )}
        {state === 'review' ? (
          <span>
            Verificar comprovante:{' '}
            {sale.receipts.find((receipt) => receipt.receiptReviewReason)
              ?.receiptReviewReason ||
              'Há dados da transação que precisam de conferência.'}
          </span>
        ) : divergent ? (
          <>
            {state === 'missing_price' ? (
              <span>Verificar preços dos produtos da venda.</span>
            ) : (
              <span className="grid gap-1">
                {saleDifference !== 0 && (
                  <span>
                    Pagamento total{' '}
                    <strong>
                      {money(Math.abs(saleDifference))}{' '}
                      {saleDifference < 0 ? 'abaixo' : 'acima'} da venda.
                    </strong>
                  </span>
                )}
                {paymentDifference !== 0 && (
                  <span>
                    Comprovantes{' '}
                    <strong>
                      {money(Math.abs(paymentDifference))}{' '}
                      {paymentDifference < 0 ? 'abaixo' : 'acima'} do saldo
                      esperado da venda após dinheiro.
                    </strong>
                  </span>
                )}
              </span>
            )}
          </>
        ) : state === 'matched' ? (
          'Comprovantes + dinheiro conferem com a venda'
        ) : state === 'not_required' ? (
          'Venda coberta por dinheiro — comprovante não exigido. Dinheiro informado manualmente.'
        ) : state === 'missing' ? (
          'Sem comprovante anexado'
        ) : (
          `Verificar comprovante · ${sale.pendingCount} arquivo(s) sem valor válido ou em leitura`
        )}
      </p>
    </div>
  );
}

type Receipt = OverviewSale['receipts'][number];
function receiptState(receipt: Receipt) {
  if (receipt.receiptReviewReason) return receipt.receiptReviewReason;
  if (receipt.receiptAmountCents !== null && receipt.receiptAmountCents <= 0)
    return 'Valor inválido · conferir na venda';
  if (receipt.receiptAmountCents !== null)
    return receipt.receiptAmountSource === 'manual'
      ? 'Valor informado manualmente'
      : 'Valor lido automaticamente';
  if (receipt.processingStatus === 'needs_review')
    return 'Leitura inconclusiva · conferir na venda';
  if (
    ['pending', 'processing', 'retry'].includes(receipt.processingStatus ?? '')
  )
    return 'Leitura em andamento';
  return 'Sem valor identificado · conferir na venda';
}

export function OverviewProductionView({
  onOpenSale,
}: {
  onOpenSale?: (id: string) => void;
}) {
  const [period, setPeriod] = useState<SalesPeriod>('today');
  const [day, setDay] = useState(localDateKey);
  const [month, setMonth] = useState(() => localDateKey().slice(0, 7));
  const [filter, setFilter] = useState<OverviewFilter>('all');
  const [cursors, setCursors] = useState<string[]>(['']);
  const pageIndex = cursors.length - 1;
  const [page, setPage] = useState<OverviewPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const paginationBusy = useRef(false);
  const params = new URLSearchParams({
    period,
    day,
    month,
    comparison: filter,
    cursor: cursors[pageIndex],
  }).toString();
  const load = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError('');
    try {
      const result = await requestJson<OverviewPage>(
        `/api/overview?${params}`,
        { signal: request.signal },
      );
      if (!request.signal.aborted) {
        setPage(result);
        setSelected((current) =>
          result.items.some((sale) =>
            sale.receipts.some((receipt) => receipt.id === current),
          )
            ? current
            : null,
        );
        // OCR can move every remaining row out of a filtered page.
        if (!result.items.length && result.totals.saleCount && pageIndex > 0)
          setCursors(['']);
      }
    } catch (error) {
      if (!request.signal.aborted) setError(messageOf(error));
    } finally {
      if (!request.signal.aborted) {
        paginationBusy.current = false;
        setLoading(false);
      }
    }
  }, [params, pageIndex]);
  useEffect(() => {
    const initial = setTimeout(() => {
      setPage(null);
      setSelected(null);
      void load();
    }, 0);
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(refresh);
      refresh = setTimeout(() => void load(), 300);
    };
    const visible = () => {
      if (!document.hidden) changed();
    };
    window.addEventListener('pdv:sales-changed', changed);
    window.addEventListener('online', changed);
    window.addEventListener('focus', changed);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearTimeout(initial);
      clearTimeout(refresh);
      controller.current?.abort();
      window.removeEventListener('pdv:sales-changed', changed);
      window.removeEventListener('online', changed);
      window.removeEventListener('focus', changed);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load]);
  // One bounded refresh for the whole screen also covers OCR completing before
  // the global status provider has established its initial version baseline.
  useEffect(() => {
    if (loading || !page?.pendingInPeriod) return;
    const timer = setTimeout(() => {
      if (!document.hidden && navigator.onLine !== false) void load();
    }, 30_000);
    return () => clearTimeout(timer);
  }, [page, load, loading]);
  const files =
    page?.items.flatMap((sale) =>
      sale.receipts.map((receipt) => ({ sale, receipt })),
    ) ?? [];
  const selectedIndex = files.findIndex((file) => file.receipt.id === selected);
  const current = files[selectedIndex];
  const totals = page?.totals;
  const comparison = totals ? overviewComparison(totals) : 'empty';

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 overflow-hidden px-3 py-3 sm:px-6 sm:py-5">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">Comprovantes</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Conferência dos pagamentos e comprovantes
          </p>
        </div>
        <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          <div className="min-w-0 flex-1">
            <PeriodFilter
              period={period}
              day={day}
              month={month}
              label="comprovantes"
              onPeriod={(value) => {
                setPeriod(value);
                setCursors(['']);
              }}
              onDay={(value) => {
                setDay(value);
                setCursors(['']);
              }}
              onMonth={(value) => {
                setMonth(value);
                setCursors(['']);
              }}
            />
          </div>
          <div className="min-w-40 flex-1 sm:w-48">
            <span className="mb-1 block text-xs font-bold text-muted-foreground">
              Conferência
            </span>
            <Select
              value={filter}
              onValueChange={(value) => {
                if (!value) return;
                setFilter(value as OverviewFilter);
                setSelected(null);
                setCursors(['']);
              }}
            >
              <SelectTrigger
                size="lg"
                className="h-11 w-full font-bold"
                aria-label="Filtrar conferência dos comprovantes"
              >
                <SelectValue>
                  {overviewFilters.find((item) => item.value === filter)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="rounded-xl p-1.5">
                {overviewFilters.map((item) => (
                  <SelectItem
                    key={item.value}
                    value={item.value}
                    className="min-h-11 text-sm font-semibold"
                  >
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="size-11 shrink-0"
            size="icon"
            variant="outline"
            aria-label="Atualizar conferência"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </header>
      <div
        className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-2"
        aria-busy={loading}
      >
        <p className="text-xs text-muted-foreground">
          Período pela data da venda, mesmo para anexos adicionados depois.
          Vendas canceladas não entram.
        </p>
        {error && (
          <div
            role="alert"
            className="rounded-xl border bg-background p-4 text-sm"
          >
            <p>{error}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {page
                ? 'Os dados abaixo podem estar desatualizados.'
                : 'Não foi possível carregar a conferência.'}
            </p>
            <Button
              className="mt-2"
              variant="outline"
              onClick={() => void load()}
            >
              Tentar novamente
            </Button>
          </div>
        )}
        {!page && loading && (
          <output className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin" />
            Carregando conferência…
          </output>
        )}
        {totals && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <div className="rounded-2xl border bg-white p-3 sm:p-4">
                <p className="text-xs font-semibold text-muted-foreground">
                  {totals.cashCents > 0
                    ? 'Saldo das vendas após dinheiro'
                    : 'Valor das vendas'}
                </p>
                <p className="mt-1 break-words text-lg font-bold tabular-nums sm:text-2xl">
                  {money(totals.pixCents)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {totals.cashCents > 0 && (
                    <>Dinheiro (manual): {money(totals.cashCents)} · </>
                  )}
                  Total pago: {money(totals.receivedCents)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {totals.saleCount} venda(s){' '}
                  {filter === 'all' ? 'no período' : 'neste filtro'}
                </p>
              </div>
              <div className="rounded-2xl border bg-white p-3 sm:p-4">
                <p className="text-xs font-semibold text-muted-foreground">
                  Total dos comprovantes
                  {totals.pendingCount ? ' · parcial' : ''}
                </p>
                <p className="mt-1 break-words text-lg font-bold tabular-nums sm:text-2xl">
                  {money(totals.receiptCents)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {totals.receiptCount} arquivo(s)
                  {totals.pendingCount
                    ? ` · ${totals.pendingCount} sem valor`
                    : ''}
                </p>
              </div>
            </div>
            {totals.saleCount > 0 && (
              <div
                className={cn(
                  'rounded-xl border p-3 text-sm',
                  comparison === 'matched'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : comparison === 'review'
                      ? 'border-amber-300 border-l-4 bg-amber-50 text-amber-950'
                      : 'border-border bg-white',
                )}
              >
                <p className="flex items-center gap-2 font-semibold">
                  {comparison === 'matched' && (
                    <Check className="size-4 shrink-0" />
                  )}
                  {comparison === 'review' && (
                    <TriangleAlert className="size-5 shrink-0" />
                  )}
                  {comparison === 'matched'
                    ? 'Valores conferem'
                    : comparison === 'pending'
                      ? 'Conferência incompleta'
                      : totals.receiptReviewCount
                        ? `${totals.receiptReviewCount} comprovante(s) para conferir`
                        : `${totals.divergentCount} venda(s) com diferença`}
                </p>
                {comparison === 'review' && (
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                    {totals.shortfallCents > 0 && (
                      <span>
                        Comprovantes abaixo do saldo da venda{' '}
                        <strong className="ml-1 text-base tabular-nums">
                          {money(totals.shortfallCents)}
                        </strong>
                      </span>
                    )}
                    {totals.surplusCents > 0 && (
                      <span>
                        Comprovantes acima do saldo da venda{' '}
                        <strong className="ml-1 text-base tabular-nums">
                          {money(totals.surplusCents)}
                        </strong>
                      </span>
                    )}
                    {totals.saleDifferenceCount > 0 && (
                      <span>
                        {totals.saleDifferenceCount} venda(s) com diferença em
                        relação ao valor da venda ou preço não definido
                      </span>
                    )}
                  </div>
                )}
                <p className="mt-1 text-xs">
                  {comparison === 'matched'
                    ? 'Comprovantes mais dinheiro conferem com o preço de cada venda. Dinheiro é informado manualmente. O status também considera as fotos dos aparelhos.'
                    : comparison === 'pending'
                      ? 'Há documentos ausentes ou ainda sem valor identificado.'
                      : 'Confira as vendas sinalizadas abaixo. Diferenças entre vendas não se compensam.'}
                </p>
                {(totals.pendingCount > 0 ||
                  totals.missingCount > 0 ||
                  totals.divergentCount > 0) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[
                      totals.pendingCount
                        ? `${totals.pendingCount} arquivo(s) sem valor identificado`
                        : '',
                      totals.missingCount
                        ? `${totals.missingCount} venda(s) sem comprovante`
                        : '',
                      totals.divergentCount
                        ? `${totals.divergentCount} venda(s) com diferença`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                {totals.cashCents > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    O total recebido inclui {money(totals.cashCents)} em
                    dinheiro, que pode não ter comprovante. Pix:{' '}
                    {money(totals.receivedCents - totals.cashCents)}.
                  </p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Esta conferência compara documentos com valores registrados.
                  Não confirma crédito na conta bancária.
                </p>
              </div>
            )}
            {!totals.saleCount && (
              <div className="rounded-2xl border bg-white p-8 text-center text-sm text-muted-foreground">
                {filter === 'all'
                  ? 'Nenhuma venda concluída neste período.'
                  : 'Nenhuma venda encontrada com este filtro no período.'}
              </div>
            )}
            {totals.saleCount > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-1 px-1">
                <h2 className="text-sm font-bold">Comprovantes por venda</h2>
                <span className="text-xs text-muted-foreground">
                  Página {pageIndex + 1} · {totals.saleCount} venda(s){' '}
                  {filter === 'all' ? 'no período' : 'neste filtro'}
                </span>
              </div>
            )}
            {page?.items.map((sale) => (
              <article
                key={sale.id}
                className="overflow-hidden rounded-2xl border bg-white"
              >
                <div className="space-y-2 border-b p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="break-words text-sm font-bold">
                        {sale.customerName}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {number(sale.number)} · {date(sale.createdAt)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!onOpenSale}
                      onClick={() => onOpenSale?.(sale.id)}
                    >
                      Ver venda
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </div>
                  <SaleDisplayStatusBadge status={sale.displayStatus} />
                  <SaleIssuesNotice issueKeys={sale.issueKeys} />
                  <SaleComparison sale={sale} />
                  {sale.cashCents > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Inclui {money(sale.cashCents)} em dinheiro.
                    </p>
                  )}
                </div>
                {sale.receipts.length > 0 && (
                  <div className="grid gap-2 p-3 sm:grid-cols-2 sm:p-4">
                    {sale.receipts.map((receipt) => (
                      <button
                        key={receipt.id}
                        type="button"
                        onClick={() => setSelected(receipt.id)}
                        className="flex min-w-0 items-center gap-3 rounded-xl border bg-slate-50/60 p-3 text-left transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <FileText className="size-5 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                          <span
                            className="block truncate text-xs font-semibold"
                            title={receipt.name}
                          >
                            {receipt.name}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {receiptState(receipt)}
                          </span>
                          <span className="mt-1 block text-sm font-bold tabular-nums">
                            {receipt.receiptAmountCents === null
                              ? 'Valor pendente'
                              : money(receipt.receiptAmountCents)}
                          </span>
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {(pageIndex > 0 ||
              (page?.nextCursor !== null &&
                page?.nextCursor !== undefined)) && (
              <div className="flex items-center justify-between gap-3 py-2">
                <Button
                  variant="outline"
                  disabled={!pageIndex || loading}
                  onClick={() => {
                    if (paginationBusy.current) return;
                    paginationBusy.current = true;
                    setLoading(true);
                    setCursors((current) => current.slice(0, -1));
                  }}
                >
                  <ArrowLeft className="size-4" />
                  Anterior
                </Button>
                <span className="text-xs text-muted-foreground">
                  Página {pageIndex + 1}
                </span>
                <Button
                  variant="outline"
                  disabled={page?.nextCursor == null || loading}
                  onClick={() => {
                    if (page?.nextCursor != null && !paginationBusy.current) {
                      paginationBusy.current = true;
                      setLoading(true);
                      setCursors((current) => [...current, page.nextCursor!]);
                    }
                  }}
                >
                  Próxima
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <Dialog
        open={Boolean(current)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="flex h-[90dvh] max-h-[900px] max-w-[calc(100%-1rem)] flex-col gap-3 overflow-hidden sm:max-w-4xl">
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle className="break-words leading-snug">
              {current?.sale.customerName} ·{' '}
              {current ? number(current.sale.number) : ''}
            </DialogTitle>
            <DialogDescription className="break-all text-xs">
              {current?.receipt.name}
            </DialogDescription>
          </DialogHeader>
          {current && (
            <>
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs">
                <span>
                  {current.receipt.receiptAmountCents === null
                    ? 'Valor pendente'
                    : money(current.receipt.receiptAmountCents)}{' '}
                  · {receiptState(current.receipt)}
                </span>
                <a
                  className="font-semibold text-primary underline underline-offset-4"
                  href={current.receipt.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir arquivo<span className="sr-only"> em nova guia</span>
                </a>
              </div>
              <ReceiptPreview
                key={current.receipt.id}
                receipt={current.receipt}
              />
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Comprovante anterior"
                    disabled={selectedIndex <= 0}
                    onClick={() =>
                      setSelected(files[selectedIndex - 1].receipt.id)
                    }
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                  <span className="text-xs tabular-nums">
                    {selectedIndex + 1} / {files.length} nesta página
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Próximo comprovante"
                    disabled={selectedIndex >= files.length - 1}
                    onClick={() =>
                      setSelected(files[selectedIndex + 1].receipt.id)
                    }
                  >
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
                <Button
                  disabled={!onOpenSale}
                  onClick={() => onOpenSale?.(current.sale.id)}
                >
                  Ver venda
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ReceiptPreview({ receipt }: { receipt: Receipt }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border bg-slate-50">
      {failed ? (
        <p className="p-5 text-center text-sm text-muted-foreground">
          Não foi possível mostrar a prévia. Use “Abrir arquivo” ou tente
          novamente.
        </p>
      ) : receipt.mimeType.startsWith('image/') ? (
        <Image
          unoptimized
          width={1200}
          height={1600}
          src={receipt.url}
          alt={`Comprovante ${receipt.name}`}
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : receipt.mimeType === 'application/pdf' ? (
        <iframe
          title={`Comprovante PDF: ${receipt.name}`}
          src={receipt.url}
          className="h-full w-full border-0"
          onError={() => setFailed(true)}
        />
      ) : (
        <p className="p-5 text-sm text-muted-foreground">
          Use “Abrir arquivo” para visualizar este anexo.
        </p>
      )}
    </div>
  );
}
