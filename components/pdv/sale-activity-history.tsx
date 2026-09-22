'use client';

import { useEffect, useRef, useState } from 'react';
import { History, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { messageOf, requestJson } from '@/lib/client-api';
import type { SaleActivityPage } from '@/lib/sale-activity';

const date = (value: number) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(value);
export function SaleActivityHistory({ saleId }: { saleId: string }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<SaleActivityPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const retryMore = useRef(false);
  useEffect(() => () => request.current?.abort(), []);
  async function load(more = false) {
    if (request.current) return;
    retryMore.current = more;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const cursor = more ? page?.nextCursor : null;
      const result = await requestJson<SaleActivityPage>(
        `/api/sales/${encodeURIComponent(saleId)}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted)
        setPage((current) => ({
          ...result,
          items: more
            ? [...(current?.items ?? []), ...result.items]
            : result.items,
        }));
    } catch (cause) {
      if (!controller.signal.aborted) setError(messageOf(cause));
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section
      className="rounded-xl border bg-card p-4 shadow-sm sm:p-5"
      aria-label="Histórico de alterações da venda"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-secondary p-3 text-primary">
            <History className="size-5" />
          </span>
          <div>
            <h3 className="font-extrabold">Histórico de alterações</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Quem alterou, quando e o que mudou nesta venda.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            if (!open && !page && !busy) void load();
          }}
        >
          {open ? 'Recolher histórico' : 'Ver histórico'}
        </Button>
      </div>
      {open && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            Horário de Brasília. Exibe os registros disponíveis; dados antigos
            ausentes não são reconstruídos. Nos eventos automáticos, o operador
            é quem iniciou a operação.
          </p>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw className="size-4" /> Atualizar histórico
          </Button>
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}{' '}
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void load(retryMore.current)}
              >
                Tentar novamente
              </Button>
            </p>
          )}
          <ol className="space-y-3">
            {page?.items.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border bg-background/60 p-3 sm:p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h4 className="text-sm font-extrabold">{item.title}</h4>
                  <time
                    className="text-xs font-semibold text-muted-foreground"
                    dateTime={new Date(item.createdAt).toISOString()}
                  >
                    {date(item.createdAt)}
                  </time>
                </div>
                <p className="mt-1 text-xs font-semibold text-primary">
                  {item.automatic
                    ? 'Automático · operação iniciada por '
                    : 'Por '}
                  {item.actor}
                </p>
                {item.changes.length > 0 && (
                  <dl className="mt-3 divide-y rounded-lg border bg-card">
                    {item.changes.map((change, index) => (
                      <div key={`${change.label}:${index}`} className="p-3">
                        <dt className="mb-2 text-xs font-bold">
                          {change.label}
                        </dt>
                        <dd className="grid gap-2 text-sm sm:grid-cols-2">
                          <div className="min-w-0 break-words">
                            <span className="mb-0.5 block text-[11px] font-semibold uppercase text-muted-foreground">
                              Antes
                            </span>
                            {change.before}
                          </div>
                          <div className="min-w-0 break-words">
                            <span className="mb-0.5 block text-[11px] font-semibold uppercase text-primary">
                              Depois
                            </span>
                            <strong>{change.after}</strong>
                          </div>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {item.notes.map((note, index) => (
                  <p
                    key={index}
                    className="mt-2 break-words text-sm text-muted-foreground"
                  >
                    {note}
                  </p>
                ))}
              </li>
            ))}
          </ol>
          {busy && (
            <output className="flex items-center gap-2 text-sm">
              <LoaderCircle className="size-4 animate-spin" /> Carregando
              histórico…
            </output>
          )}
          {!busy && !error && page?.items.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Não há eventos disponíveis para esta venda antiga.
            </p>
          )}
          {page?.nextCursor && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void load(true)}
            >
              Carregar alterações anteriores
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
