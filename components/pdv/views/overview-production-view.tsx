'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { PeriodFilter, localDateKey } from '@/components/pdv/period-filter';
import { Button } from '@/components/ui/button';
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
const difference = (value: number) =>
  value < 0
    ? `Comprovantes abaixo do pago informado em ${money(-value)}`
    : value > 0
      ? `Comprovantes acima do pago informado em ${money(value)}`
      : 'Comprovantes e pago informado têm o mesmo total';

type Receipt = OverviewSale['receipts'][number];
function receiptState(receipt: Receipt) {
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
      if (!request.signal.aborted) setPage(result);
    } catch (error) {
      if (!request.signal.aborted) setError(messageOf(error));
    } finally {
      if (!request.signal.aborted) {
        paginationBusy.current = false;
        setLoading(false);
      }
    }
  }, [params]);
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
    if (loading || !page?.totals.pendingCount) return;
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
          <h1 className="text-xl font-bold sm:text-2xl">Visão geral</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Conferência dos pagamentos e comprovantes
          </p>
        </div>
        <div className="flex w-full items-start gap-2 sm:w-auto">
          <div className="min-w-0 flex-1">
            <PeriodFilter
              period={period}
              day={day}
              month={month}
              label="visão geral"
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
                  Pago informado
                </p>
                <p className="mt-1 break-words text-lg font-bold tabular-nums sm:text-2xl">
                  {money(totals.receivedCents)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {totals.saleCount} venda(s) no período
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
                    : 'border-border bg-white',
                )}
              >
                <p className="flex items-center gap-2 font-semibold">
                  {comparison === 'matched' && (
                    <Check className="size-4 shrink-0" />
                  )}
                  {comparison === 'matched'
                    ? 'Valores conferem com os pagamentos informados'
                    : comparison === 'pending'
                      ? 'Conferência incompleta'
                      : 'Revisar comprovantes por venda'}
                </p>
                <p className="mt-1 text-xs">
                  {comparison === 'pending'
                    ? 'O total dos comprovantes ainda não permite concluir a conferência.'
                    : difference(totals.receiptCents - totals.receivedCents) +
                      '.'}
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
                    O pago informado inclui {money(totals.cashCents)} em
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
                Nenhuma venda concluída neste período.
              </div>
            )}
            {totals.saleCount > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-1 px-1">
                <h2 className="text-sm font-bold">Comprovantes por venda</h2>
                <span className="text-xs text-muted-foreground">
                  Página {pageIndex + 1} · {totals.saleCount} venda(s) no
                  período
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
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                    <span>
                      Pago informado{' '}
                      <strong className="ml-1 tabular-nums">
                        {money(sale.receivedCents)}
                      </strong>
                    </span>
                    <span>
                      Comprovantes{sale.pendingCount ? ' (parcial)' : ''}{' '}
                      <strong className="ml-1 tabular-nums">
                        {money(sale.receiptCents)}
                      </strong>
                    </span>
                  </div>
                  <p
                    className={cn(
                      'text-xs font-medium',
                      sale.receiptCount &&
                        !sale.pendingCount &&
                        sale.receiptCents === sale.receivedCents
                        ? 'text-emerald-700'
                        : 'text-muted-foreground',
                    )}
                  >
                    {!sale.receiptCount
                      ? 'Sem comprovante anexado'
                      : sale.pendingCount
                        ? `${sale.pendingCount} arquivo(s) sem valor identificado · conferência pendente`
                        : difference(sale.receiptCents - sale.receivedCents)}
                  </p>
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
