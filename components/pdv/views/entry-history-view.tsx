'use client';

/* oxlint-disable next/no-img-element -- authenticated attachment URLs must load directly with the session cookie */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  Clock3,
  LoaderCircle,
  PackageCheck,
  Search,
  Smartphone,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { messageOf, requestJson } from '@/lib/client-api';
import { loadEntryHistoryPages } from '@/lib/entry-history-refresh';
import type { EntriesPage, EntryRecord } from '@/lib/pdv-types';

export function EntryHistoryView() {
  const [query, setQuery] = useState('');
  const [day, setDay] = useState('');
  const [selected, setSelected] = useState<EntryRecord | null>(null);
  const [page, setPage] = useState<EntriesPage>({
    items: [],
    nextCursor: null,
    total: 0,
    aggregates: { entryCount: 0, unitCount: 0, photoCount: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const requestIdRef = useRef(0);
  const loadedCountRef = useRef(0);
  const inFlightRef = useRef(false);
  const loadEntries = useCallback(
    async (cursor: string | null = null, append = false, preserve = false) => {
      if (preserve && inFlightRef.current) return;
      const requestId = ++requestIdRef.current;
      inFlightRef.current = true;
      if (!preserve) setLoading(true);
      setLoadError('');
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (query.trim()) params.set('q', query.trim());
        if (day) {
          const { from, to } = dayBounds(day);
          params.set('from', String(from));
          params.set('to', String(to));
        }
        const next = await loadEntryHistoryPages(
          (nextCursor) => {
            if (nextCursor) params.set('cursor', nextCursor);
            else params.delete('cursor');
            return requestJson<EntriesPage>(
              `/api/entries?${params.toString()}`,
            );
          },
          preserve ? Math.max(50, loadedCountRef.current) : 50,
          cursor,
          () => requestId === requestIdRef.current,
        );
        if (!next || requestId !== requestIdRef.current) return;
        loadedCountRef.current = append
          ? loadedCountRef.current + next.items.length
          : next.items.length;
        setPage((current) =>
          append ? { ...next, items: [...current.items, ...next.items] } : next,
        );
      } catch (error) {
        if (requestId === requestIdRef.current) setLoadError(messageOf(error));
      } finally {
        if (requestId === requestIdRef.current) {
          inFlightRef.current = false;
          setLoading(false);
        }
      }
    },
    [day, query],
  );

  useEffect(() => {
    loadedCountRef.current = 0;
    const cancelPending = () => {
      ++requestIdRef.current;
      inFlightRef.current = false;
    };
    const timer = window.setTimeout(() => void loadEntries(), 250);
    return () => {
      cancelPending();
      window.clearTimeout(timer);
    };
  }, [loadEntries]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (!document.hidden) void loadEntries(null, false, true);
    };
    const interval = window.setInterval(refreshIfVisible, 60_000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    window.addEventListener('online', refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshIfVisible);
      window.removeEventListener('online', refreshIfVisible);
    };
  }, [loadEntries]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-3 py-3 sm:px-6 sm:py-5 lg:px-10">
      <div className="mb-3 shrink-0">
        <p className="eyebrow">Rastreabilidade</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-[-.04em] sm:text-3xl">
          Histórico de entradas
        </h1>
        <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
          Cada confirmação preserva produto, SNs, fotos, data e operador.
        </p>
      </div>
      <div className="mb-3 grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="Entradas" value={String(page.aggregates.entryCount)} />
        <Metric label="Aparelhos" value={String(page.aggregates.unitCount)} />
        <Metric
          className="hidden sm:block"
          label="Fotos vinculadas"
          value={String(page.aggregates.photoCount)}
        />
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 border-b p-3 sm:p-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Pesquisar no histórico de entradas"
                className="h-11 rounded-xl pl-9"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Modelo, SN ou operador"
                value={query}
              />
            </div>
            <Input
              aria-label="Filtrar por data"
              className="h-11 rounded-xl"
              onChange={(event) => setDay(event.target.value)}
              type="date"
              value={day}
            />
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto p-0 overscroll-contain">
          {loadError && page.items.length > 0 && (
            <div className="border-b bg-destructive/5 p-3 text-sm" role="alert">
              <p>{loadError} As entradas já carregadas foram mantidas.</p>
              <Button
                className="mt-2"
                variant="outline"
                onClick={() => void loadEntries(null, false, true)}
              >
                Atualizar novamente
              </Button>
            </div>
          )}
          {loadError && page.items.length === 0 ? (
            <div
              className="grid h-full min-h-52 place-items-center p-6 text-center"
              role="alert"
            >
              <div>
                <AlertTriangle className="mx-auto size-8 text-destructive" />
                <p className="mt-3 text-sm font-semibold text-destructive">
                  {loadError}
                </p>
                <Button
                  className="mt-3 h-11"
                  onClick={() => void loadEntries()}
                >
                  Tentar novamente
                </Button>
              </div>
            </div>
          ) : loading && page.items.length === 0 ? (
            <output
              aria-live="polite"
              className="grid h-full min-h-52 place-items-center text-sm font-semibold text-muted-foreground"
            >
              <span className="flex items-center gap-2">
                <LoaderCircle className="size-5 animate-spin text-primary" />
                Carregando entradas…
              </span>
            </output>
          ) : page.items.length === 0 ? (
            <div className="grid h-full min-h-52 place-items-center p-6 text-center">
              <div>
                <PackageCheck className="mx-auto size-9 text-muted-foreground" />
                <p className="mt-3 font-bold">
                  {query || day
                    ? 'Nenhuma entrada encontrada'
                    : 'Nenhuma entrada registrada'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {query || day
                    ? 'Ajuste os filtros.'
                    : 'As entradas confirmadas aparecerão aqui.'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="divide-y">
                {page.items.map((entry) => (
                  <button
                    className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/35 sm:px-5"
                    key={entry.id}
                    onClick={() => setSelected(entry)}
                    type="button"
                  >
                    <span className="grid size-11 place-items-center rounded-xl bg-secondary text-primary">
                      <Smartphone className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-bold">
                        {entry.productName}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {entry.productDetail} ·{' '}
                        {formatDateTime(entry.createdAt)} · {entry.operatorName}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant="secondary">
                        {entry.quantity} {entry.quantity === 1 ? 'SN' : 'SNs'}
                      </Badge>
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-center gap-3 border-t p-3">
                <span className="text-xs text-muted-foreground">
                  {page.items.length} de {page.total}
                </span>
                {page.nextCursor && (
                  <Button
                    disabled={loading}
                    onClick={() => void loadEntries(page.nextCursor, true)}
                    size="sm"
                    variant="outline"
                  >
                    {loading && <LoaderCircle className="animate-spin" />}
                    Carregar mais
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <EntryDetail
        entry={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}

function EntryDetail({
  entry,
  onOpenChange,
}: {
  entry: EntryRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(entry)}>
      <DialogContent className="flex max-h-[92dvh] max-w-2xl flex-col overflow-hidden">
        {entry && (
          <>
            <DialogHeader>
              <DialogTitle>{entry.productName}</DialogTitle>
              <DialogDescription>{entry.productDetail}</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 overscroll-contain">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Detail
                  icon={Clock3}
                  label="Data"
                  value={formatDateTime(entry.createdAt)}
                />
                <Detail
                  icon={PackageCheck}
                  label="Quantidade"
                  value={String(entry.quantity)}
                />
                <Detail
                  icon={Smartphone}
                  label="Operador"
                  value={entry.operatorName}
                />
              </div>
              <section>
                <div className="flex items-center justify-between">
                  <h3 className="font-bold">Números de série</h3>
                  <Badge variant="secondary">{entry.serials.length}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {entry.serials.map((serial) => (
                    <code
                      className="truncate rounded-xl bg-muted px-3 py-2 text-sm font-semibold"
                      key={serial}
                    >
                      {serial}
                    </code>
                  ))}
                </div>
              </section>
              <section>
                <div className="flex items-center justify-between">
                  <h3 className="font-bold">Fotos da entrada</h3>
                  <Badge variant="secondary">
                    <Camera className="mr-1 size-3" />
                    {entry.photos.length}
                  </Badge>
                </div>
                {entry.photos.length ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {entry.photos.map((photo) => (
                      <a
                        className="overflow-hidden rounded-xl border"
                        href={photo.url}
                        key={photo.id}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <img
                          alt={photo.name}
                          className="aspect-square w-full object-cover"
                          decoding="async"
                          loading="lazy"
                          src={photo.url}
                        />
                        <span className="block truncate p-2 text-xs">
                          {photo.name}
                        </span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 rounded-xl bg-muted p-3 text-sm text-muted-foreground">
                    Nenhuma foto vinculada.
                  </p>
                )}
              </section>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Metric({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <Card className={className} size="sm">
      <CardContent className="p-3">
        <p className="truncate text-xs font-bold uppercase text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 text-lg font-extrabold">{value}</p>
      </CardContent>
    </Card>
  );
}
function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <Icon className="size-4 text-primary" />
      <p className="mt-2 text-xs font-bold uppercase text-muted-foreground">
        {label}
      </p>
      <p className="truncate text-sm font-bold">{value}</p>
    </div>
  );
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
