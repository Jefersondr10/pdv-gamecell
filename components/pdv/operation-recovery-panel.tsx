'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudUpload, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  acknowledgeOperation,
  listOperations,
  recoverOperation,
  type RecoveryContext,
  type SavedOperation,
} from '@/lib/client-operation-recovery';

export function OperationRecoveryPanel({
  context,
  onChanged,
}: {
  context: RecoveryContext;
  onChanged: () => void;
}) {
  const { storeId, userId, csrfToken } = context;
  const [rows, setRows] = useState<SavedOperation[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const alive = useRef(true);
  const refresh = useCallback(
    () =>
      listOperations({ storeId, userId })
        .then((rows) => {
          if (alive.current) {
            setRows(rows.filter((row) => !row.foregroundAcknowledged));
            setError('');
          }
        })
        .catch(() => {
          if (alive.current)
            setError(
              'Não foi possível consultar os envios guardados neste aparelho.',
            );
        }),
    [storeId, userId],
  );
  const recover = useCallback(async () => {
    if (navigator.onLine === false || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const pending = (await listOperations({ storeId, userId })).filter(
        (row) =>
          row.state === 'pending' && (row.nextAttemptAt ?? 0) <= Date.now(),
      );
      for (const row of pending) {
        if (!alive.current) break;
        try {
          await recoverOperation({ storeId, userId, csrfToken }, row);
          if (alive.current) onChanged();
        } catch {
          /* Retain a visible pending/rejected operation. */
        }
      }
    } catch {
      setError(
        'Não foi possível consultar os envios guardados. Tente novamente.',
      );
    } finally {
      await refresh();
      setBusy(false);
      running.current = false;
    }
    // oxlint-disable-next-line react/react-compiler -- The finally path uses refresh; retain it together with every independently captured scope field.
  }, [storeId, userId, csrfToken, refresh, onChanged]);
  useEffect(() => {
    alive.current = true;
    queueMicrotask(() => {
      if (alive.current) {
        void refresh();
        void recover();
      }
    });
    const show = () => setOpen(true);
    const changed = () => void refresh();
    const online = () => void recover();
    const timer = window.setInterval(() => {
      if (!document.hidden) void recover();
    }, 60_000);
    window.addEventListener('pdv:operations-changed', changed);
    window.addEventListener('pdv:show-operations', show);
    window.addEventListener('online', online);
    return () => {
      alive.current = false;
      clearInterval(timer);
      window.removeEventListener('pdv:operations-changed', changed);
      window.removeEventListener('pdv:show-operations', show);
      window.removeEventListener('online', online);
    };
  }, [refresh, recover]);
  if (!rows.length && !error) return null;
  const pending = rows.filter((row) => row.state === 'pending').length;
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2 text-sm">
        <output>
          {pending
            ? `${pending} envio(s) aguardando confirmação`
            : error ||
              (rows.some((row) => row.state === 'confirmed')
                ? 'Há envios confirmados para conferir'
                : 'Há tentativas não concluídas para conferir')}
        </output>
        <Button onClick={() => setOpen(true)} size="sm" variant="outline">
          <CloudUpload className="size-4" />
          Envios
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Envios deste aparelho</DialogTitle>
            <DialogDescription>
              Uma venda ou entrada só está concluída quando o servidor confirma.
              Use a mesma conta e loja para recuperar.
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert">{error}</p>}
          {rows.map((row) => (
            <article
              key={`${row.kind}:${row.id}`}
              className="rounded-xl border p-3 text-sm"
            >
              <p className="font-semibold">
                {row.kind === 'sale' ? 'Venda' : 'Entrada'} · {row.label}
              </p>
              <p className="mt-1 text-muted-foreground">
                {new Date(row.createdAt).toLocaleString('pt-BR')}
              </p>
              <p
                className={`mt-2 font-semibold ${row.state === 'confirmed' ? 'text-emerald-700' : 'text-amber-800'}`}
              >
                {row.state === 'confirmed'
                  ? `Confirmada${row.result?.number ? ` · #${String(row.result.number).padStart(5, '0')}` : ''}${row.result?.status === 'cancelled' ? ' — cancelada posteriormente' : ''}`
                  : row.state === 'rejected'
                    ? 'Não concluída: confira os dados'
                    : 'Aguardando confirmação — não refaça a operação'}
              </p>
              {row.error && <p className="mt-1">{row.error}</p>}
              {row.state !== 'pending' && (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void acknowledgeOperation(row)
                      .then(refresh)
                      .catch(() =>
                        setError(
                          'Não foi possível atualizar a confirmação neste aparelho.',
                        ),
                      )
                  }
                >
                  Entendi
                </Button>
              )}
            </article>
          ))}
          <Button disabled={busy} onClick={() => void recover()}>
            {busy && <LoaderCircle className="size-4 animate-spin" />}Conferir e
            retomar envios
          </Button>
          <p className="text-xs text-muted-foreground">
            Os envios ainda pendentes dependem dos dados deste aparelho. Não
            desinstale o aplicativo nem limpe os dados antes da confirmação.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
