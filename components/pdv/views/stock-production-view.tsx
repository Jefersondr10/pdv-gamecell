'use client';

/* oxlint-disable next/no-img-element -- authenticated attachment URLs must load directly with the session cookie */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Camera,
  FileText,
  LoaderCircle,
  Printer,
  Search,
  Smartphone,
  TrendingUp,
  Warehouse,
} from 'lucide-react';

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

type StockRow = ProductRecord & {
  received: number;
  available: number;
  sold: number;
  serials: string[];
  photos: AttachmentRecord[];
};

export function StockProductionView({ data }: { data: BootstrapData }) {
  const [query, setQuery] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
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
  const normalized = query.trim().toLocaleLowerCase('pt-BR');
  const filtered = rows.filter((row) =>
    `${row.model} ${row.color} ${row.memory} ${row.codes.map((code) => code.code).join(' ')}`
      .toLocaleLowerCase('pt-BR')
      .includes(normalized),
  );
  const available = rows.reduce((sum, row) => sum + row.available, 0);
  const soldToday = data.metrics.soldTodayItems;

  return (
    <Page>
      <Heading
        action={
          <Button
            className="h-10 rounded-xl"
            disabled={summaryLoading || Boolean(summaryError)}
            onClick={() => {
              setReportGeneratedAt(Date.now());
              setReportOpen(true);
            }}
            variant="outline"
          >
            <FileText /> Relatório
          </Button>
        }
        description="Quantidade por modelo, cor e memória e rastreabilidade individual por SN."
        eyebrow="Inventário"
        title="Estoque"
      />
      <div className="mb-3 grid shrink-0 grid-cols-3 gap-2 sm:gap-3">
        <Metric
          icon={Warehouse}
          label="Disponíveis"
          value={String(available)}
        />
        <Metric
          icon={Smartphone}
          label="Variações"
          value={String(rows.length)}
        />
        <Metric
          icon={TrendingUp}
          label="Vendidos hoje"
          value={String(soldToday)}
        />
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 border-b p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="hidden sm:block">
              <CardTitle className="text-base">Produtos cadastrados</CardTitle>
              <CardDescription>
                O estoque começa vazio e cresce somente pelas entradas
                confirmadas.
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-11 rounded-xl pl-9"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Modelo, cor, memória ou código"
                value={query}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto p-0 overscroll-contain">
          {summaryLoading ? (
            <div className="grid h-full min-h-52 place-items-center text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <LoaderCircle className="size-4 animate-spin" /> Atualizando
                estoque…
              </span>
            </div>
          ) : summaryError ? (
            <div className="grid h-full min-h-52 place-items-center p-6 text-center">
              <div>
                <AlertCircle className="mx-auto size-9 text-destructive" />
                <p className="mt-3 font-bold">
                  Não foi possível carregar o estoque
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {summaryError}
                </p>
                <Button className="mt-3" onClick={() => void loadSummary()}>
                  Tentar novamente
                </Button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="grid h-full min-h-52 place-items-center p-6 text-center">
              <div>
                <Smartphone className="mx-auto size-9 text-muted-foreground" />
                <p className="mt-3 font-bold">
                  {rows.length
                    ? 'Nenhum produto encontrado'
                    : 'Nenhum produto cadastrado'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {rows.length
                    ? 'Tente outra pesquisa.'
                    : 'Cadastre o primeiro produto em Configurações.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((row) => (
                <div
                  className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_auto_auto_auto] sm:px-5"
                  key={row.id}
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold">{row.model}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.detail} ·{' '}
                      {row.codes
                        .map((code) => displayCode(code.code))
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="text-right sm:text-center">
                    <p className="text-[.65rem] font-bold uppercase text-muted-foreground">
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
                  <div className="hidden text-center sm:block">
                    <p className="text-[.65rem] font-bold uppercase text-muted-foreground">
                      Recebidos
                    </p>
                    <p className="font-bold">{row.received}</p>
                  </div>
                  <div className="hidden text-center sm:block">
                    <p className="text-[.65rem] font-bold uppercase text-muted-foreground">
                      Vendidos
                    </p>
                    <p className="font-bold">{row.sold}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
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
        rows={rows}
        storeName={data.store.name}
      />
    </Page>
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
  const byModel = useMemo(() => {
    const grouped = new Map<string, number>();
    rows.forEach((row) =>
      grouped.set(row.model, (grouped.get(row.model) ?? 0) + row.available),
    );
    return Array.from(grouped, ([model, quantity]) => ({ model, quantity }));
  }, [rows]);
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 rounded-none p-0 sm:h-[90dvh] sm:max-w-4xl sm:rounded-2xl">
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
              <ReportMetric label="Modelos" value={String(byModel.length)} />
              <ReportMetric label="Variações" value={String(rows.length)} />
            </div>
            <section className="report-section mt-5">
              <h3 className="font-extrabold">Quantidade por aparelho</h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {byModel.map((item) => (
                  <div
                    className="flex justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    key={item.model}
                  >
                    <span>{item.model}</span>
                    <strong>{item.quantity}</strong>
                  </div>
                ))}
                {byModel.length === 0 && (
                  <p className="text-sm text-slate-500">
                    Nenhum aparelho disponível.
                  </p>
                )}
              </div>
            </section>
            <section className="report-section mt-5 space-y-3">
              {rows.map((row) => (
                <div
                  className="report-row rounded-xl border border-slate-200 p-3"
                  key={row.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold">{row.model}</h3>
                      <p className="text-sm text-slate-600">
                        {row.color} · {row.memory}
                      </p>
                    </div>
                    <strong>{row.available} disponíveis</strong>
                  </div>
                  {level === 'serials' && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {row.serials.map((serial) => (
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
                  {includePhotos && row.photos.length > 0 && (
                    <div className="mt-3 border-t border-slate-200 pt-3">
                      <p className="text-xs font-bold uppercase text-slate-500">
                        Fotos das entradas
                      </p>
                      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {row.photos.map((photo) => (
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
                              src={photo.url}
                            />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </section>
          </article>
        </div>
        <DialogFooter
          className="shrink-0 border-t bg-background p-3"
          data-report-controls
        >
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
            disabled={needsDetails && !detailsComplete}
            onClick={() => window.print()}
          >
            <Printer /> Imprimir / salvar PDF
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-3 py-3 sm:px-6 sm:py-5 lg:px-10">
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
    <div className="mb-3 flex shrink-0 items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-[-.04em] sm:text-3xl">
          {title}
        </h1>
        <p className="mt-1 hidden truncate text-sm text-muted-foreground sm:block">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Warehouse;
  label: string;
  value: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-2 p-2.5 sm:p-4">
        <span className="hidden size-9 place-items-center rounded-xl bg-secondary text-primary sm:grid">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[.65rem] font-bold uppercase text-muted-foreground sm:text-xs">
            {label}
          </p>
          <p className="font-extrabold">{value}</p>
        </div>
      </CardContent>
    </Card>
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
function displayCode(code: string) {
  return code.replace(/^0+(?=\d)/, '');
}
function formatDateTime(value: number) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
