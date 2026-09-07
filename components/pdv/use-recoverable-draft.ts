'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { get, update } from 'idb-keyval';
import { createOperationId } from '@/lib/client-operation-id';
import {
  recoveryScopeKey,
  type OperationKind,
  type RecoveryScope,
} from '@/lib/client-operation-recovery';

type Draft<T> = { operationId: string; revision: number; value: T };
export function useRecoverableDraft<T>(input: {
  scope?: RecoveryScope;
  kind: OperationKind;
  operationId: { current: string };
  value: T;
  empty: boolean;
  done: boolean;
  restore: (value: T) => void;
  confirmed: (result: { added?: number }) => void;
}) {
  const key = input.scope
    ? `pdv:draft:v1:${recoveryScopeKey(input.scope)}:${input.kind}`
    : '';
  const [ready, setReady] = useState(!key);
  const [label, setLabel] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [loadedKey, setLoadedKey] = useState('');
  const [blocked, setBlocked] = useState('');
  const current = useRef(input);
  useEffect(() => {
    current.current = input;
  }, [input]);
  const revision = useRef(0);
  const ownedId = useRef('');
  const queue = useRef(Promise.resolve());
  const completedIds = useRef(new Set<string>());
  const markConfirmed = useCallback(
    (result: { added?: number }) => {
      const id = current.current.operationId.current;
      if (completedIds.current.has(id)) return;
      completedIds.current.add(id);
      setWaiting(false);
      queue.current = queue.current
        .then(() =>
          update<Draft<T> | undefined>(key, (saved) =>
            saved?.operationId === id ? undefined : saved,
          ),
        )
        .catch(() => {});
      current.current.confirmed(result);
    },
    [key],
  );

  useEffect(() => {
    if (!key) return;
    let alive = true;
    ownedId.current = current.current.operationId.current;
    void get<Draft<T>>(key)
      .then(async (draft) => {
        if (!alive) return;
        if (draft) {
          current.current.operationId.current = draft.operationId;
          revision.current = draft.revision;
          ownedId.current = draft.operationId;
          current.current.restore(draft.value);
          setLabel('Rascunho recuperado neste aparelho');
          const { listOperations } =
            await import('@/lib/client-operation-recovery');
          const row = (await listOperations(current.current.scope!)).find(
            (row) =>
              row.id === draft.operationId && row.kind === current.current.kind,
          );
          if (!alive) return;
          if (row?.state === 'confirmed') markConfirmed(row.result ?? {});
          else if (row?.state === 'pending') setWaiting(true);
          else if (row?.state === 'rejected') {
            current.current.operationId.current = createOperationId();
            setLabel(
              row.error || 'Confira os dados antes de confirmar novamente.',
            );
          }
        }
      })
      .catch(() => {
        if (alive)
          setBlocked(
            'Não foi possível recuperar o rascunho neste aparelho. Reabra a tela antes de continuar.',
          );
      })
      .finally(() => {
        if (alive) {
          setLoadedKey(key);
          setReady(true);
        }
      });
    const confirmed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        detail?.id === current.current.operationId.current &&
        detail?.kind === current.current.kind &&
        detail?.storeId === current.current.scope?.storeId &&
        detail?.userId === current.current.scope?.userId
      )
        markConfirmed(detail.result ?? {});
    };
    const rejected = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        detail?.id === current.current.operationId.current &&
        detail?.kind === current.current.kind &&
        detail?.storeId === current.current.scope?.storeId &&
        detail?.userId === current.current.scope?.userId
      ) {
        setWaiting(false);
        current.current.operationId.current = createOperationId();
        setLabel(
          detail.error || 'Confira os dados antes de confirmar novamente.',
        );
      }
    };
    const refresh = async () => {
      if (!alive || !current.current.scope) return;
      const { listOperations } =
        await import('@/lib/client-operation-recovery');
      const row = (await listOperations(current.current.scope)).find(
        (row) =>
          row.id === current.current.operationId.current &&
          row.kind === current.current.kind,
      );
      if (!alive) return;
      if (row?.state === 'confirmed') markConfirmed(row.result ?? {});
      if (row?.state === 'pending') setWaiting(true);
      if (row?.state === 'rejected')
        rejected(new CustomEvent('rejected', { detail: row }));
    };
    const focus = () => {
      void refresh().catch(() => {});
    };
    window.addEventListener('pdv:operation-confirmed', confirmed);
    window.addEventListener('pdv:operation-rejected', rejected);
    window.addEventListener('focus', focus);
    window.addEventListener('pdv:operations-changed', focus);
    return () => {
      alive = false;
      window.removeEventListener('pdv:operation-confirmed', confirmed);
      window.removeEventListener('pdv:operation-rejected', rejected);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pdv:operations-changed', focus);
    };
  }, [key, markConfirmed]);

  useEffect(() => {
    if (!key || !ready || loadedKey !== key || waiting || blocked) return;
    const { value, empty, done } = input;
    const id = input.operationId.current;
    queue.current = queue.current
      .then(async () => {
        if (completedIds.current.has(id) || done || empty) {
          await update<Draft<T> | undefined>(key, (saved) => {
            if (
              saved &&
              (saved.operationId !== ownedId.current ||
                saved.revision !== revision.current)
            )
              throw new Error(
                'Este rascunho está aberto em outra aba. Feche a outra aba e reabra esta tela.',
              );
            return undefined;
          });
          if (done || empty) {
            revision.current = 0;
            ownedId.current = id;
            setLabel('');
          }
          return;
        }
        const expected = revision.current;
        await update<Draft<T>>(key, (existing) => {
          if (existing && existing.revision !== expected)
            throw new Error(
              'Este rascunho foi alterado em outra aba. Feche a outra aba e confira antes de continuar.',
            );
          return { operationId: id, revision: expected + 1, value };
        });
        revision.current = expected + 1;
        ownedId.current = id;
        setLabel('Rascunho salvo neste aparelho');
      })
      .catch((error: unknown) =>
        setBlocked(
          error instanceof Error
            ? error.message
            : 'Não foi possível guardar o rascunho. Verifique o espaço do aparelho.',
        ),
      );
  }, [
    key,
    loadedKey,
    ready,
    input.value,
    input.empty,
    input.done,
    input.operationId,
    waiting,
    blocked,
  ]);

  return {
    ready: ready && (!key || loadedKey === key),
    label,
    waiting,
    setWaiting,
    blocked,
  };
}
