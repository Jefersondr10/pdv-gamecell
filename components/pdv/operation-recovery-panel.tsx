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
  recoverPendingOperations,
  replaceOperationAttachment,
  type RecoveryContext,
  type SavedOperation,
} from '@/lib/client-operation-recovery';
import { messageOf } from '@/lib/client-api';
import { OperationAttachmentRepair } from './operation-attachment-repair';

export function OperationRecoveryPanel({
  context,
  onChanged,
  onOpenMenu,
}: {
  onOpenMenu?: () => void;
  context: RecoveryContext;
  onChanged: () => void;
}) {
  const { storeId, userId, csrfToken } = context;
  const [rows, setRows] = useState<SavedOperation[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [activity, setActivity] = useState('');
  const [outcomeErrors, setOutcomeErrors] = useState<Record<string, string>>(
    {},
  );
  const running = useRef(false);
  const alive = useRef(true);
  const refresh = useCallback(
    () =>
      listOperations({ storeId, userId })
        .then((rows) => {
          if (alive.current) {
            setRows(rows.filter((row) => !row.foregroundAcknowledged));
            setStorageError('');
          }
        })
        .catch(() => {
          if (alive.current)
            setStorageError(
              'Não foi possível consultar os envios guardados neste aparelho.',
            );
        }),
    [storeId, userId],
  );
  const recover = useCallback(
    async (manual = false) => {
      if (running.current) return;
      if (navigator.onLine === false) {
        if (manual) {
          setActivity('');
          setError(
            'Sem conexão. Reconecte à internet e toque novamente; o envio está guardado.',
          );
        }
        return;
      }
      running.current = true;
      setBusy(true);
      setError('');
      if (manual) {
        setOutcomeErrors({});
        setActivity('Conferindo os envios no servidor…');
      }
      try {
        const outcomes = await recoverPendingOperations(
          { storeId, userId, csrfToken },
          {
            manual,
            shouldContinue: () => alive.current,
            onProgress: (row, index, total) => {
              if (alive.current)
                setActivity(
                  `Conferindo ${index} de ${total}: ${row.label}. Aguarde a resposta do servidor…`,
                );
            },
            onSettled: (outcome) => {
              if (!alive.current) return;
              setOutcomeErrors((previous) => ({
                ...previous,
                [`${outcome.row.kind}:${outcome.row.id}`]: outcome.error ?? '',
              }));
              void refresh();
            },
          },
        );
        if (alive.current && (manual || outcomes.length)) {
          const confirmed = outcomes.filter(
            (outcome) => outcome.state === 'confirmed',
          ).length;
          const unresolved = outcomes.length - confirmed;
          setError('');
          setActivity(
            !outcomes.length
              ? 'Nenhum envio pendente para retomar.'
              : unresolved
                ? `${confirmed ? `${confirmed} envio(s) confirmado(s). ` : ''}${unresolved} envio(s) não concluído(s). Veja o motivo em cada envio.`
                : `${confirmed} envio(s) confirmado(s) pelo servidor.`,
          );
          if (confirmed) onChanged();
        }
      } catch {
        if (alive.current) {
          setActivity('');
          setError(
            'Não foi possível consultar os envios guardados neste aparelho. Tente novamente sem limpar os dados.',
          );
        }
      } finally {
        await refresh();
        if (alive.current) setBusy(false);
        running.current = false;
      }
      // oxlint-disable-next-line react/react-compiler -- The finally path uses refresh; retain it together with every independently captured scope field.
    },
    [storeId, userId, csrfToken, refresh, onChanged],
  );
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
  if (!rows.length && !error && !storageError) return null;
  const pending = rows.filter((row) => row.state === 'pending').length;
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2 text-sm">
        <output>
          {pending
            ? `${pending} envio(s) aguardando confirmação`
            : error ||
              storageError ||
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
          {(error || storageError) && (
            <p
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm font-semibold text-destructive"
            >
              {error || storageError}
            </p>
          )}
          {activity && (
            <output
              aria-live="polite"
              className="rounded-xl border bg-muted/50 p-3 text-sm font-medium"
            >
              {activity}
            </output>
          )}
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
              {row.state !== 'confirmed' &&
                (outcomeErrors[`${row.kind}:${row.id}`] || row.error) && (
                  <p
                    role="alert"
                    className="mt-2 rounded-lg bg-amber-50 p-2 font-medium text-amber-900"
                  >
                    {outcomeErrors[`${row.kind}:${row.id}`] || row.error}
                  </p>
                )}
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
              {row.state === 'pending' && row.attachmentIssue && (
                <OperationAttachmentRepair
                  key={`${row.id}:${row.attachmentIssue.index}`}
                  issue={row.attachmentIssue}
                  busy={busy}
                  onRepair={async (file) => {
                    if (running.current) return false;
                    running.current = true;
                    setBusy(true);
                    setError('');
                    setActivity('Conferindo o envio e guardando o anexo…');
                    let resume = false;
                    let saved = false;
                    try {
                      const result = await replaceOperationAttachment(
                        { storeId, userId, csrfToken },
                        row,
                        row.attachmentIssue!.index,
                        file,
                      );
                      saved = true;
                      if (alive.current) {
                        setOutcomeErrors((previous) => ({
                          ...previous,
                          [`${row.kind}:${row.id}`]: '',
                        }));
                        if (result.confirmed) {
                          setActivity(
                            'O servidor já confirmou este envio. Nenhum anexo foi substituído.',
                          );
                          onChanged();
                        } else resume = true;
                      }
                    } catch (caught) {
                      if (alive.current) {
                        setActivity('');
                        setError(messageOf(caught));
                      }
                    } finally {
                      await refresh();
                      running.current = false;
                      if (alive.current) setBusy(false);
                    }
                    if (resume && alive.current) await recover(true);
                    return saved;
                  }}
                />
              )}
            </article>
          ))}
          <Button
            disabled={busy || pending === 0}
            aria-busy={busy}
            onClick={() => void recover(true)}
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            {busy ? 'Conferindo envios…' : 'Conferir e retomar envios'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Os envios ainda pendentes dependem dos dados deste aparelho. Não
            desinstale o aplicativo nem limpe os dados antes da confirmação.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
              onOpenMenu?.();
            }}
          >
            {onOpenMenu ? 'Continuar no sistema' : 'Fechar e continuar'}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
