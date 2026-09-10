'use client';

import { matchesProductSearch } from '@/lib/product-search';
import { chunkReportItems } from '@/lib/report-pagination';
import { summarizeStockByMemory } from '@/lib/stock-report-summary';
/* oxlint-disable next/no-img-element -- authenticated attachment URLs must load directly with the session cookie */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  ChevronRight,
  Download,
  FileText,
  LoaderCircle,
  MessageCircle,
  Pencil,
  Check,
  Search,
  Smartphone,
} from 'lucide-react';

import { ProductColorSwatch } from '@/components/pdv/product-color-swatch';
import { StockWhatsAppDialog } from '@/components/pdv/stock-whatsapp-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { messageOf, requestJson } from '@/lib/client-api';
import type {
  AttachmentRecord,
  BootstrapData,
  InventoryDetailRecord,
  InventoryPage,
  ProductRecord,
  StockSummaryRecord,
  StockSummaryResponse,
} from '@/lib/pdv-types';
import { displayCommercialCode } from '@/lib/commercial-code';
import { downloadReportPdf } from '@/lib/download-report-pdf';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { changedProductPrices, priceInput } from '@/lib/product-prices';

type StockRow = ProductRecord & {
  received: number;
  available: number;
  sold: number;
  serials: string[];
  photos: AttachmentRecord[];
};

export function StockProductionView({
  data,
  onChanged,
  onOpenSale,
}: {
  data: BootstrapData;
  onChanged: (
    prices?: { productId: string; defaultPriceCents: number }[],
  ) => Promise<void>;
  onOpenSale?: (saleId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [serialSearch, setSerialSearch] = useState<{
    query: string;
    ids: string[];
  }>({ query: '', ids: [] });
  const [serialSearchError, setSerialSearchError] = useState('');
  const [serialSearching, setSerialSearching] = useState(false);
  useEffect(() => {
    const term = query.trim();
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSerialSearchError('');
      if (!/^[a-z0-9]{6,18}$/i.test(term) || !/[0-9]/.test(term)) {
        setSerialSearching(false);
        return;
      }
      setSerialSearching(true);
      try {
        const result = await requestJson<{ productIds: string[] }>(
          `/api/inventory?view=serial-search&q=${encodeURIComponent(term)}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted)
          setSerialSearch({ query: term, ids: result.productIds });
      } catch (error) {
        if (!controller.signal.aborted)
          setSerialSearchError(
            `Busca por SN indisponível: ${messageOf(error)}`,
          );
      } finally {
        if (!controller.signal.aborted) setSerialSearching(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  const serialProductIds = new Set(
    serialSearch.query === query.trim() ? serialSearch.ids : [],
  );
  const [stockFilter, setStockFilter] = useState<'available' | 'empty' | 'all'>(
    'available',
  );
  const [reportOpen, setReportOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [reportGeneratedAt, setReportGeneratedAt] = useState(() => Date.now());
  const [summary, setSummary] = useState<StockSummaryRecord[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [details, setDetails] = useState<InventoryDetailRecord[]>([]);
  const [detailsTotal, setDetailsTotal] = useState<number | null>(null);
  const [detailsCursor, setDetailsCursor] = useState<string | null>(null);
  const [detailsStarted, setDetailsStarted] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [selectedRow, setSelectedRow] = useState<StockRow | null>(null);
  const [editingPrices, setEditingPrices] = useState(false);
  const [priceBaseline, setPriceBaseline] = useState<Record<string, number>>(
    {},
  );
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceError, setPriceError] = useState('');
  const [priceNotice, setPriceNotice] = useState('');
  const priceChanges = useMemo(() => {
    try {
      return {
        rows: changedProductPrices(priceBaseline, priceDraft),
        error: '',
      };
    } catch (error) {
      return { rows: [], error: messageOf(error) };
    }
  }, [priceBaseline, priceDraft]);
  const startPriceEditing = () => {
    setPriceBaseline(
      Object.fromEntries(data.products.map((p) => [p.id, p.defaultPriceCents])),
    );
    setPriceDraft({});
    setPriceError('');
    setPriceNotice('');
    setEditingPrices(true);
  };
  const savePrices = async () => {
    if (priceSaving || !priceChanges.rows.length || priceChanges.error) return;
    setPriceSaving(true);
    setPriceError('');
    try {
      await requestJson('/api/products/prices', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': data.csrfToken,
        },
        body: JSON.stringify({ prices: priceChanges.rows }),
      });
      setPriceNotice(`${priceChanges.rows.length} preço(s) salvo(s).`);
      setEditingPrices(false);
      setPriceDraft({});
      try {
        await onChanged(priceChanges.rows);
      } catch {
        setPriceError(
          'Os preços foram salvos e já aparecem aqui. Não foi possível atualizar os demais dados da loja agora.',
        );
      }
    } catch (error) {
      setPriceError(messageOf(error));
    } finally {
      setPriceSaving(false);
    }
  };

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const result = await requestJson<StockSummaryResponse>(
        '/api/inventory?view=summary',
      );
      setSummary(result.rows);
    } catch (error) {
      setSummaryError(messageOf(error));
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSummary(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSummary]);

  const loadDetails = useCallback(async () => {
    if (detailsLoading) return;
    setDetailsStarted(true);
    setDetailsLoading(true);
    setDetailsError('');
    try {
      const params = new URLSearchParams({ limit: '99', includePhotos: '1' });
      if (detailsCursor) params.set('cursor', detailsCursor);
      const result = await requestJson<InventoryPage>(
        `/api/inventory?${params.toString()}`,
      );
      setDetails((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        result.items.forEach((item) => byId.set(item.id, item));
        return Array.from(byId.values());
      });
      if (result.total !== null) setDetailsTotal(result.total);
      setDetailsCursor(result.nextCursor);
    } catch (error) {
      setDetailsError(messageOf(error));
    } finally {
      setDetailsLoading(false);
    }
  }, [detailsCursor, detailsLoading]);

  const rows = useMemo(
    () => buildRows(data, summary, details),
    [data, details, summary],
  );
  const rowsWithStock = rows.filter((row) => row.available > 0);
  const normalized = query.trim();
  const filtered = rows.filter(
    (row) =>
      (stockFilter === 'all' ||
        (stockFilter === 'available'
          ? row.available > 0
          : row.available === 0) ||
        serialProductIds.has(row.id)) &&
      (serialProductIds.has(row.id) || matchesProductSearch(row, query)),
  );
  const available = rows.reduce((sum, row) => sum + row.available, 0);

  return (
    <Page>
      <Heading
        action={
          <div className="flex shrink-0 items-center justify-end gap-1">
            {can(data.user, 'products.manage') && !editingPrices && (
              <Button
                className="h-10 rounded-xl px-3"
                variant="secondary"
                onClick={startPriceEditing}
                disabled={
                  summaryLoading ||
                  Boolean(summaryError) ||
                  !rows.length ||
                  priceSaving
                }
              >
                <Pencil /> <span>Preços</span>
              </Button>
            )}
            <Button
              className="h-10 rounded-xl px-3"
              onClick={() => setWhatsappOpen(true)}
              disabled={editingPrices || priceSaving}
              variant="outline"
            >
              <MessageCircle className="text-success" />
              <span className="hidden sm:inline">Lista para </span>WhatsApp
            </Button>
            <Button
              aria-label="Relatório de estoque em PDF"
              className="h-10 rounded-xl"
              disabled={
                summaryLoading ||
                Boolean(summaryError) ||
                editingPrices ||
                priceSaving
              }
              onClick={() => {
                setReportGeneratedAt(Date.now());
                setReportOpen(true);
              }}
              variant="outline"
            >
              <FileText /> <span className="hidden sm:inline">Relatório</span>
            </Button>
          </div>
        }
        description="Quantidade por modelo, cor e memória e rastreabilidade individual por SN."
        eyebrow="Inventário"
        title="Estoque"
      />
      {!editingPrices && (
        <p className="mb-2 text-sm text-muted-foreground">
          <strong className="text-foreground">{available}</strong> aparelhos
          disponíveis · {rowsWithStock.length} variações com estoque
        </p>
      )}
      {priceNotice && (
        <output className="mb-2 shrink-0 text-sm font-semibold text-success">
          {priceNotice}
        </output>
      )}
      {serialSearching && (
        <output className="mb-1 text-xs text-muted-foreground">
          Procurando SN…
        </output>
      )}
      {serialSearchError && (
        <p role="alert" className="mb-1 text-sm text-destructive">
          {serialSearchError}
        </p>
      )}
      {priceError && (
        <p
          role="alert"
          className="mb-2 shrink-0 rounded-xl bg-destructive/10 p-2 text-sm text-destructive"
        >
          {priceError}
        </p>
      )}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 border-b p-2">
          <div className="flex items-center justify-between gap-3">
            <div className="sr-only">
              <CardTitle className="text-base">
                {editingPrices ? 'Editar preços padrão' : 'Estoque disponível'}
              </CardTitle>
              <CardDescription>
                {editingPrices
                  ? 'Válidos nas próximas vendas e na lista do WhatsApp.'
                  : 'A lista mostra somente a quantidade disponível de cada variação.'}
              </CardDescription>
            </div>
            <div className="flex w-full flex-wrap gap-2">
              <div className="relative min-w-0 flex-1 basis-full sm:w-80 sm:basis-auto">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Pesquisar no estoque"
                  className="h-11 rounded-xl pl-9"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Modelo, cor, memória, código ou SN"
                  value={query}
                />
              </div>
              <div
                className="flex shrink-0 gap-1 rounded-xl bg-muted/60 p-1"
                aria-label="Disponibilidade do estoque"
              >
                {(
                  [
                    ['available', 'Com estoque'],
                    ['empty', 'Sem estoque'],
                    ['all', 'Todos'],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    aria-pressed={stockFilter === value}
                    onClick={() => setStockFilter(value)}
                    variant={stockFilter === value ? 'secondary' : 'ghost'}
                    className="h-9 rounded-lg px-2 text-xs font-bold"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto p-0 overscroll-contain">
          {summaryLoading ? (
            <output
              aria-live="polite"
              className="grid h-full min-h-52 place-items-center text-sm text-muted-foreground"
            >
              <span className="flex items-center gap-2">
                <LoaderCircle className="size-4 animate-spin" /> Atualizando
                estoque…
              </span>
            </output>
          ) : summaryError ? (
            <div
              className="grid h-full min-h-52 place-items-center p-6 text-center"
              role="alert"
            >
              <div>
                <AlertCircle className="mx-auto size-9 text-destructive" />
                <p className="mt-3 font-bold">
                  Não foi possível carregar o estoque
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {summaryError}
                </p>
                <Button
                  className="mt-3 h-11"
                  onClick={() => void loadSummary()}
                >
                  Tentar novamente
                </Button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="grid h-full min-h-52 place-items-center p-6 text-center">
              <div>
                <Smartphone className="mx-auto size-9 text-muted-foreground" />
                <p className="mt-3 font-bold">
                  {normalized
                    ? 'Nenhum produto encontrado'
                    : rows.length
                      ? 'Nenhum produto com estoque disponível'
                      : 'Nenhum produto cadastrado'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {normalized
                    ? 'Tente outra pesquisa.'
                    : rows.length
                      ? 'Desative o filtro para ver os cadastros zerados.'
                      : 'Cadastre o primeiro produto em Configurações.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((row) => (
                <div
                  key={row.id}
                  className={cn(
                    'grid grid-cols-[minmax(0,1fr)_7rem] items-center border-l-4 border-transparent transition-colors focus-within:border-primary focus-within:bg-primary/10 sm:grid-cols-[minmax(0,1fr)_9rem]',
                    editingPrices &&
                      priceDraft[row.id] !== undefined &&
                      (priceChanges.rows.some(
                        (price) => price.productId === row.id,
                      ) ||
                        Boolean(priceChanges.error)) &&
                      'border-l-amber-400 bg-amber-50/60 dark:bg-amber-950/20',
                  )}
                >
                  <button
                    aria-label={`Abrir estoque de ${row.model}, ${row.color}, ${row.memory}`}
                    className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-3"
                    disabled={editingPrices}
                    onClick={() => setSelectedRow(row)}
                    type="button"
                  >
                    <span className="grid size-7 place-items-center rounded-lg bg-secondary">
                      <ProductColorSwatch
                        className="size-5"
                        color={row.color}
                        model={row.model}
                      />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-bold">{row.model}</p>
                      {serialProductIds.has(row.id) && (
                        <p className="text-xs font-semibold text-primary">
                          SN localizado no histórico
                        </p>
                      )}
                      <div className="mt-1 grid w-full max-w-60 grid-cols-[minmax(0,1fr)_4rem] items-center gap-1.5">
                        <span className="flex min-w-0 items-center gap-1.5 truncate text-sm text-muted-foreground">
                          <ProductColorSwatch
                            color={row.color}
                            model={row.model}
                          />
                          <span className="truncate" title={row.color}>
                            {row.color}
                          </span>
                        </span>
                        <Badge
                          className="w-16 justify-center whitespace-nowrap font-extrabold tabular-nums"
                          variant="secondary"
                        >
                          {row.memory}
                        </Badge>
                      </div>
                      <p className="sr-only">
                        {row.codes
                          .map((code) =>
                            displayCommercialCode(code.code, code.kind),
                          )
                          .join(' · ')}
                      </p>
                    </div>
                    <div className="text-right sm:text-center">
                      <p className="text-xs font-bold uppercase text-muted-foreground">
                        Disponíveis
                      </p>
                      <Badge
                        className={
                          row.available <= 2
                            ? 'bg-amber-500/10 text-amber-900 hover:bg-amber-500/10'
                            : 'bg-success/10 text-success hover:bg-success/10'
                        }
                      >
                        {row.available}
                      </Badge>
                    </div>
                  </button>
                  <div className="py-2 pl-1 pr-2 sm:pr-3">
                    {editingPrices ? (
                      <label
                        htmlFor={`stock-price-${row.id}`}
                        className="block text-xs font-semibold text-muted-foreground"
                      >
                        Preço · R$
                        <Input
                          id={`stock-price-${row.id}`}
                          aria-label={`Preço padrão de ${row.model}, ${row.color}, ${row.memory}`}
                          className="mt-1 h-11 bg-background text-right text-base font-bold text-foreground"
                          inputMode="decimal"
                          disabled={priceSaving}
                          value={
                            priceDraft[row.id] ??
                            priceInput(
                              priceBaseline[row.id] ?? row.defaultPriceCents,
                            )
                          }
                          onChange={(event) =>
                            setPriceDraft((current) => ({
                              ...current,
                              [row.id]: event.target.value,
                            }))
                          }
                        />
                        {priceDraft[row.id] !== undefined &&
                          priceDraft[row.id] !==
                            priceInput(
                              priceBaseline[row.id] ?? row.defaultPriceCents,
                            ) && (
                            <span className="mt-1 block text-xs text-amber-800 dark:text-amber-200">
                              Antes:{' '}
                              {priceInput(
                                priceBaseline[row.id] ?? row.defaultPriceCents,
                              )}
                            </span>
                          )}
                      </label>
                    ) : (
                      <p className="text-right text-sm font-bold">
                        <span className="mr-2 text-xs font-medium text-muted-foreground sm:mr-0 sm:block">
                          Preço
                        </span>
                        R$ {priceInput(row.defaultPriceCents)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
        {editingPrices && (
          <div className="shrink-0 space-y-2 border-t bg-muted/30 p-3">
            <p
              role={priceChanges.error ? 'alert' : 'status'}
              className={`text-sm ${priceChanges.error ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {priceChanges.error ||
                `${priceChanges.rows.length} preço(s) alterado(s), incluindo os ocultos pela pesquisa. Vendas anteriores não mudam.`}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={priceSaving}
                onClick={() => {
                  setEditingPrices(false);
                  setPriceDraft({});
                  setPriceError('');
                  void onChanged().catch((error) =>
                    setPriceError(messageOf(error)),
                  );
                }}
              >
                Cancelar
              </Button>
              <Button
                disabled={
                  priceSaving ||
                  !priceChanges.rows.length ||
                  Boolean(priceChanges.error)
                }
                onClick={() => void savePrices()}
              >
                {priceSaving ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Check />
                )}
                {priceSaving ? 'Salvando…' : 'Salvar alterações'}
              </Button>
            </div>
          </div>
        )}
      </Card>
      <StockReport
        detailsCursor={detailsCursor}
        detailsError={detailsError}
        detailsLoading={detailsLoading}
        detailsStarted={detailsStarted}
        detailsTotal={detailsTotal}
        generatedAt={reportGeneratedAt}
        onLoadDetails={() => void loadDetails()}
        open={reportOpen}
        onOpenChange={setReportOpen}
        rows={rowsWithStock}
        storeName={data.store.name}
      />
      {whatsappOpen && (
        <StockWhatsAppDialog
          storeName={data.store.name}
          onClose={() => setWhatsappOpen(false)}
        />
      )}
      {selectedRow && (
        <StockProductDetails
          key={selectedRow.id}
          onOpenChange={(open) => !open && setSelectedRow(null)}
          onOpenSale={onOpenSale}
          row={selectedRow}
        />
      )}
    </Page>
  );
}

function StockProductDetails({
  row,
  onOpenChange,
  onOpenSale,
}: {
  row: StockRow;
  onOpenChange: (open: boolean) => void;
  onOpenSale?: (saleId: string) => void;
}) {
  const [status, setStatus] = useState<'available' | 'sold'>('available');
  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<InventoryDetailRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedUnit, setSelectedUnit] =
    useState<InventoryDetailRecord | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<AttachmentRecord | null>(
    null,
  );
  const [unitLoadingId, setUnitLoadingId] = useState('');
  const requestIdRef = useRef(0);
  const unitRequestIdRef = useRef(0);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      unitRequestIdRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryDraft.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [queryDraft]);

  const loadPage = useCallback(
    async (nextCursor: string | null) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          productId: row.id,
          status,
          limit: '99',
        });
        if (query) params.set('q', query);
        if (nextCursor) params.set('cursor', nextCursor);
        const result = await requestJson<InventoryPage>(
          `/api/inventory?${params.toString()}`,
        );
        if (requestId !== requestIdRef.current) return;
        setItems((current) => {
          if (!nextCursor) return result.items;
          const byId = new Map(current.map((item) => [item.id, item]));
          result.items.forEach((item) => byId.set(item.id, item));
          return Array.from(byId.values());
        });
        if (result.total !== null) setTotal(result.total);
        setCursor(result.nextCursor);
        setStarted(true);
      } catch (caught) {
        if (requestId !== requestIdRef.current) return;
        setError(messageOf(caught));
        setStarted(true);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [query, row.id, status],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setItems([]);
      setCursor(null);
      setTotal(null);
      setStarted(false);
      setError('');
      void loadPage(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPage]);

  const openUnit = async (item: InventoryDetailRecord) => {
    const requestId = ++unitRequestIdRef.current;
    if (item.status === 'sold' && item.saleId && onOpenSale) {
      onOpenChange(false);
      onOpenSale(item.saleId);
      return;
    }
    setUnitLoadingId(item.id);
    setError('');
    try {
      const params = new URLSearchParams({
        unitId: item.id,
        status: 'all',
        includePhotos: '1',
        limit: '10',
      });
      const result = await requestJson<InventoryPage>(
        `/api/inventory?${params.toString()}`,
      );
      if (requestId !== unitRequestIdRef.current) return;
      setSelectedUnit(result.items.find((unit) => unit.id === item.id) ?? item);
    } catch (caught) {
      if (requestId !== unitRequestIdRef.current) return;
      setError(messageOf(caught));
    } finally {
      if (requestId === unitRequestIdRef.current) setUnitLoadingId('');
    }
  };

  const goBack = () => {
    if (selectedPhoto) {
      setSelectedPhoto(null);
      return;
    }
    setSelectedUnit(null);
  };

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] [&_[data-slot=dialog-close]]:top-[calc(.5rem+env(safe-area-inset-top))] sm:h-[90dvh] sm:max-w-3xl sm:rounded-2xl sm:pb-0 sm:pt-0 sm:[&_[data-slot=dialog-close]]:top-2">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12">
          <div className="flex items-center gap-3">
            {(selectedUnit || selectedPhoto) && (
              <Button
                aria-label="Voltar para a lista de SNs"
                className="size-10 shrink-0 rounded-xl"
                onClick={goBack}
                size="icon"
                variant="outline"
              >
                <ArrowLeft />
              </Button>
            )}
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary">
              <ProductColorSwatch
                className="size-7"
                color={row.color}
                model={row.model}
              />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate">{row.model}</DialogTitle>
              <DialogDescription className="mt-1 flex items-center gap-2">
                <ProductColorSwatch color={row.color} model={row.model} />
                <span className="truncate">{row.color}</span>
                <Badge className="font-extrabold" variant="secondary">
                  {row.memory}
                </Badge>
              </DialogDescription>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-muted px-2 py-1.5">
              <span className="block text-muted-foreground">Disponível</span>
              <strong>{row.available}</strong>
            </div>
            <div className="rounded-lg bg-muted px-2 py-1.5">
              <span className="block text-muted-foreground">Recebido</span>
              <strong>{row.received}</strong>
            </div>
            <div className="rounded-lg bg-muted px-2 py-1.5">
              <span className="block text-muted-foreground">Vendido</span>
              <strong>{row.sold}</strong>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 overscroll-contain sm:p-4">
          {selectedPhoto && selectedUnit ? (
            <div className="mx-auto max-w-2xl">
              <p className="font-mono text-sm font-bold">
                SN {selectedUnit.serial}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Foto da entrada de {formatDateTime(selectedUnit.createdAt)}
              </p>
              <img
                alt={`Foto da entrada do SN ${selectedUnit.serial}`}
                className="mt-3 max-h-[65dvh] w-full rounded-2xl border bg-muted object-contain"
                decoding="async"
                src={selectedPhoto.url}
              />
            </div>
          ) : selectedUnit ? (
            <div className="mx-auto max-w-2xl">
              <div className="rounded-2xl border bg-muted/25 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase text-muted-foreground">
                      Número de série
                    </p>
                    <p className="mt-1 break-all font-mono text-lg font-extrabold">
                      {selectedUnit.serial}
                    </p>
                  </div>
                  <Badge
                    className={
                      selectedUnit.status === 'available'
                        ? 'bg-success/10 text-success hover:bg-success/10'
                        : undefined
                    }
                    variant={
                      selectedUnit.status === 'available'
                        ? 'default'
                        : 'secondary'
                    }
                  >
                    {selectedUnit.status === 'available'
                      ? 'Disponível'
                      : 'Vendido'}
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Entrada em {formatDateTime(selectedUnit.createdAt)}
                </p>
                {selectedUnit.status === 'sold' &&
                  selectedUnit.saleId &&
                  onOpenSale && (
                    <Button
                      className="mt-3 h-11 w-full rounded-xl"
                      onClick={() => {
                        onOpenChange(false);
                        onOpenSale(selectedUnit.saleId!);
                      }}
                    >
                      Abrir venda
                      {selectedUnit.saleNumber
                        ? ` #${String(selectedUnit.saleNumber).padStart(5, '0')}`
                        : ''}
                      <ChevronRight />
                    </Button>
                  )}
              </div>
              <h3 className="mt-5 font-bold">Fotos da entrada</h3>
              {selectedUnit.photos.length ? (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {selectedUnit.photos.map((photo) => (
                    <button
                      className="overflow-hidden rounded-2xl border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      key={photo.id}
                      onClick={() => setSelectedPhoto(photo)}
                      type="button"
                    >
                      <img
                        alt={`Foto da entrada do SN ${selectedUnit.serial}`}
                        className="aspect-square w-full object-cover"
                        decoding="async"
                        loading="lazy"
                        src={photo.url}
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-3 rounded-2xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                  Esta entrada não possui foto disponível.
                </p>
              )}
            </div>
          ) : !started || (loading && items.length === 0) ? (
            <div className="grid min-h-52 place-items-center text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <LoaderCircle className="size-4 animate-spin" /> Carregando SNs…
              </span>
            </div>
          ) : error && items.length === 0 ? (
            <div className="grid min-h-52 place-items-center text-center">
              <div>
                <AlertCircle className="mx-auto size-8 text-destructive" />
                <p className="mt-2 font-bold">Não foi possível abrir os SNs</p>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
                <Button className="mt-3" onClick={() => void loadPage(null)}>
                  Tentar novamente
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-3 grid gap-2">
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
                  <Button
                    className="h-9 rounded-lg"
                    onClick={() => setStatus('available')}
                    size="sm"
                    variant={status === 'available' ? 'default' : 'ghost'}
                  >
                    Disponíveis ({row.available})
                  </Button>
                  <Button
                    className="h-9 rounded-lg"
                    onClick={() => setStatus('sold')}
                    size="sm"
                    variant={status === 'sold' ? 'default' : 'ghost'}
                  >
                    Vendidos ({row.sold})
                  </Button>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Pesquisar número de série"
                    className="h-10 rounded-xl pl-9"
                    onChange={(event) => setQueryDraft(event.target.value)}
                    placeholder="Pesquisar SN"
                    value={queryDraft}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {items.length}
                  {total === null ? '' : ` de ${total}`}{' '}
                  {status === 'available' ? 'disponíveis' : 'vendidos'}
                </p>
              </div>
              <div className="divide-y overflow-hidden rounded-2xl border">
                {items.map((item) => (
                  <button
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 bg-card px-3 py-3 text-left transition-colors hover:bg-muted/45"
                    key={item.id}
                    onClick={() => void openUnit(item)}
                    type="button"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-bold">
                        {item.serial}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {item.status === 'sold' && item.saleNumber
                          ? `Venda #${String(item.saleNumber).padStart(5, '0')} · toque para abrir`
                          : `Entrada ${formatDateTime(item.createdAt)} · toque para ver a foto`}
                      </p>
                    </div>
                    <Badge
                      className={
                        item.status === 'available'
                          ? 'bg-success/10 text-success hover:bg-success/10'
                          : undefined
                      }
                      variant={
                        item.status === 'available' ? 'default' : 'secondary'
                      }
                    >
                      {item.status === 'available' ? 'Disponível' : 'Vendido'}
                    </Badge>
                    {unitLoadingId === item.id ? (
                      <LoaderCircle className="size-4 animate-spin text-primary" />
                    ) : (
                      <ChevronRight className="size-4 text-muted-foreground" />
                    )}
                  </button>
                ))}
                {items.length === 0 && (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    {query
                      ? 'Nenhum SN encontrado nesta lista.'
                      : status === 'available'
                        ? 'Este produto não possui SN disponível.'
                        : 'Este produto ainda não possui SN vendido.'}
                  </p>
                )}
              </div>
              {error && (
                <p className="mt-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </p>
              )}
              {cursor && (
                <Button
                  className="mt-3 h-11 w-full rounded-xl"
                  disabled={loading}
                  onClick={() => void loadPage(cursor)}
                  variant="outline"
                >
                  {loading ? 'Carregando…' : 'Carregar mais SNs'}
                </Button>
              )}
            </>
          )}
        </div>
        <div className="shrink-0 border-t bg-background p-3 text-right">
          <Button
            className="h-10 min-w-28"
            onClick={() => onOpenChange(false)}
            variant="outline"
          >
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StockReport({
  open,
  onOpenChange,
  rows,
  storeName,
  generatedAt,
  detailsCursor,
  detailsError,
  detailsLoading,
  detailsStarted,
  detailsTotal,
  onLoadDetails,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: StockRow[];
  storeName: string;
  generatedAt: number;
  detailsCursor: string | null;
  detailsError: string;
  detailsLoading: boolean;
  detailsStarted: boolean;
  detailsTotal: number | null;
  onLoadDetails: () => void;
}) {
  const [level, setLevel] = useState<'summary' | 'serials'>('summary');
  const [includePhotos, setIncludePhotos] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const reportRef = useRef<HTMLElement | null>(null);
  const needsDetails = level === 'serials' || includePhotos;
  const detailsComplete =
    detailsStarted &&
    !detailsLoading &&
    detailsCursor === null &&
    !detailsError;
  useEffect(() => {
    if (!open || !needsDetails || detailsStarted) return;
    const timer = window.setTimeout(onLoadDetails, 0);
    return () => window.clearTimeout(timer);
  }, [detailsStarted, needsDetails, onLoadDetails, open]);
  const available = rows.reduce((sum, row) => sum + row.available, 0);
  const summary = useMemo(() => summarizeStockByMemory(rows), [rows]);
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 rounded-none p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] [&_[data-slot=dialog-close]]:top-[calc(.5rem+env(safe-area-inset-top))] sm:h-[90dvh] sm:max-w-4xl sm:rounded-2xl sm:pb-0 sm:pt-0 sm:[&_[data-slot=dialog-close]]:top-2">
        <DialogHeader
          className="shrink-0 border-b px-4 py-3 pr-12"
          data-report-controls
        >
          <DialogTitle>Relatório de estoque</DialogTitle>
          <DialogDescription>
            Escolha o nível e se deseja acompanhar as fotos das entradas.
          </DialogDescription>
        </DialogHeader>
        <div
          className="grid shrink-0 gap-2 border-b bg-muted/30 p-3 sm:grid-cols-3"
          data-report-controls
        >
          <Button
            className="h-11 rounded-xl"
            onClick={() => setLevel('summary')}
            variant={level === 'summary' ? 'default' : 'outline'}
          >
            Modelo, cor e memória
          </Button>
          <Button
            className="h-11 rounded-xl"
            onClick={() => setLevel('serials')}
            variant={level === 'serials' ? 'default' : 'outline'}
          >
            Detalhado por SN
          </Button>
          <Button
            className="h-11 rounded-xl"
            onClick={() => setIncludePhotos((value) => !value)}
            variant={includePhotos ? 'secondary' : 'outline'}
          >
            <Camera /> {includePhotos ? 'Fotos incluídas' : 'Incluir fotos'}
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
                {level === 'summary'
                  ? 'Estoque por modelo, cor e memória'
                  : 'Estoque detalhado por SN'}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Gerado em {formatDateTime(generatedAt)}
              </p>
            </header>
            {needsDetails && !detailsComplete && (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                {detailsLoading ? (
                  <span className="flex items-center gap-2 font-semibold">
                    <LoaderCircle className="size-4 animate-spin" /> Carregando
                    SNs e fotos…
                  </span>
                ) : detailsError ? (
                  <span>{detailsError}</span>
                ) : detailsCursor ? (
                  <span>
                    Carregados{' '}
                    {rows.reduce((sum, row) => sum + row.serials.length, 0)}
                    {detailsTotal === null ? '' : ` de ${detailsTotal}`}{' '}
                    aparelhos. Carregue o restante para gerar o relatório
                    completo.
                  </span>
                ) : (
                  <span>Preparando os dados detalhados…</span>
                )}
              </div>
            )}
            <div className="report-section mt-4 grid grid-cols-3 gap-2">
              <ReportMetric label="Disponíveis" value={String(available)} />
              <ReportMetric
                label="Modelos"
                value={String(summary.modelCount)}
              />
              <ReportMetric label="Variações" value={String(rows.length)} />
            </div>
            <section className="report-section mt-5">
              <h3 className="font-extrabold">
                Quantidade por modelo e memória
              </h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {summary.groups.map((item) => (
                  <div
                    className="report-row flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    key={item.key}
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span>{item.model}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">
                        {item.memory || 'Memória não informada'}
                      </span>
                    </span>
                    <strong className="shrink-0 tabular-nums">
                      {item.quantity}
                    </strong>
                  </div>
                ))}
                {summary.groups.length === 0 && (
                  <p className="text-sm text-slate-500">
                    Nenhum aparelho disponível.
                  </p>
                )}
              </div>
            </section>
            <section className="report-section mt-5 space-y-3">
              {rows.flatMap((row) => {
                const serialChunks =
                  level === 'serials' ? chunkReportItems(row.serials, 12) : [];
                const photoChunks = includePhotos
                  ? chunkReportItems(row.photos, 3)
                  : [];
                const parts = [
                  ...(serialChunks.length ? serialChunks : [[]]).map(
                    (serials) => ({ serials, photos: [] as typeof row.photos }),
                  ),
                  ...photoChunks.map((photos) => ({
                    serials: [] as string[],
                    photos,
                  })),
                ];
                return parts.map((part, partIndex) => (
                  <div
                    className="report-row rounded-xl border border-slate-200 p-3"
                    key={`${row.id}-${partIndex}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold">{row.model}</h3>
                        {partIndex > 0 && (
                          <p className="text-xs text-slate-500">
                            Continuação ·{' '}
                            {part.photos.length
                              ? 'Fotos das entradas'
                              : 'Números de série'}
                          </p>
                        )}
                        <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
                          <ProductColorSwatch
                            color={row.color}
                            model={row.model}
                          />
                          <span>{row.color}</span>
                          <span aria-hidden>·</span>
                          <strong className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-900">
                            {row.memory}
                          </strong>
                        </p>
                      </div>
                      <strong>{row.available} disponíveis</strong>
                    </div>
                    {level === 'serials' && !part.photos.length && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {part.serials.map((serial) => (
                          <code
                            className="rounded bg-slate-100 px-2 py-1 text-xs"
                            key={serial}
                          >
                            {serial}
                          </code>
                        ))}
                        {row.serials.length === 0 && (
                          <span className="text-sm text-slate-500">
                            Sem SN disponível.
                          </span>
                        )}
                      </div>
                    )}
                    {part.photos.length > 0 && (
                      <div className="mt-3 border-t border-slate-200 pt-3">
                        <p className="text-xs font-bold uppercase text-slate-500">
                          Fotos das entradas
                        </p>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {part.photos.map((photo) => (
                            <a
                              className="block overflow-hidden rounded-lg border border-slate-200"
                              href={photo.url}
                              key={photo.id}
                              rel="noreferrer"
                              target="_blank"
                            >
                              <img
                                alt={`Entrada de ${row.model}`}
                                className="aspect-square w-full object-cover"
                                decoding="async"
                                loading="lazy"
                                src={photo.url}
                              />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ));
              })}
            </section>
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
          {needsDetails &&
            !detailsLoading &&
            (detailsCursor || detailsError) && (
              <Button onClick={onLoadDetails} variant="secondary">
                {detailsError ? 'Tentar novamente' : 'Carregar mais'}
              </Button>
            )}
          <Button
            disabled={pdfBusy || (needsDetails && !detailsComplete)}
            onClick={async () => {
              if (!reportRef.current) return;
              setPdfBusy(true);
              setPdfError('');
              try {
                await downloadReportPdf({
                  element: reportRef.current,
                  fileName: `estoque-${dateFileKey(generatedAt)}`,
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

function buildRows(
  data: BootstrapData,
  summaryRows: StockSummaryRecord[],
  detailRows: InventoryDetailRecord[],
): StockRow[] {
  const summaryByProduct = new Map(
    summaryRows.map((row) => [row.productId, row]),
  );
  return data.products.map((product) => {
    const summary = summaryByProduct.get(product.id);
    const units = detailRows.filter((unit) => unit.productId === product.id);
    const photosById = new Map(
      units.flatMap((unit) => unit.photos).map((photo) => [photo.id, photo]),
    );
    return {
      ...product,
      received: summary?.received ?? 0,
      available: summary?.available ?? 0,
      sold: summary?.sold ?? 0,
      serials: units.map((unit) => unit.serial),
      photos: Array.from(photosById.values()),
    };
  });
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-2 py-2 sm:px-4 sm:py-3 lg:px-6">
      {children}
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="sr-only">{eyebrow}</p>
        <h1 className="text-xl font-bold tracking-[-.04em] sm:text-2xl">
          {title}
        </h1>
        <p className="sr-only">{description}</p>
      </div>
      {action}
    </div>
  );
}
function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-100 p-3">
      <dt className="text-xs font-bold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-extrabold">{value}</dd>
    </div>
  );
}
function formatDateTime(value: number) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function dateFileKey(value: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}
