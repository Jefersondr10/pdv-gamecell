'use client';

import { entries, update } from 'idb-keyval';
import { ApiError, requestJson } from './client-api.ts';

export type OperationKind = 'sale' | 'entry';
export type RecoveryScope = { storeId: string; userId: string };
export type RecoveryContext = RecoveryScope & { csrfToken: string };
export type SavedOperation = RecoveryScope & {
  id: string;
  kind: OperationKind;
  label: string;
  createdAt: number;
  state: 'pending' | 'confirmed' | 'rejected';
  error?: string;
  form: Array<[string, FormDataEntryValue]>;
  fingerprint: string;
  result?: OperationResult;
  nextAttemptAt?: number;
  attempts?: number;
  foregroundAcknowledged?: boolean;
  leaseOwner?: string;
  leaseUntil?: number;
};
export type OperationResult = {
  id: string;
  added?: number;
  number?: number;
  status?: string;
  receipts?: never[];
};
export class PendingOperationError extends Error {}
export class RejectedOperationError extends Error {}
const prefix = 'pdv:outbox:v1:';
const inFlight = new Map<string, Promise<OperationResult>>();
export const recoveryScopeKey = (scope: RecoveryScope) =>
  `${scope.storeId}:${scope.userId}`;
const keyFor = (scope: RecoveryScope, kind: OperationKind, id: string) =>
  `${prefix}${recoveryScopeKey(scope)}:${kind}:${id}`;
let channel: BroadcastChannel | undefined;
const tabId = () => globalThis.crypto.randomUUID();
function ensureChannel() {
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('pdv:operations-v1');
    channel.onmessage = () =>
      window.dispatchEvent(new Event('pdv:operations-changed'));
  }
}
function notify() {
  ensureChannel();
  window.dispatchEvent(new Event('pdv:operations-changed'));
  channel?.postMessage('changed');
}

export async function listOperations(
  scope: RecoveryScope,
): Promise<SavedOperation[]> {
  ensureChannel();
  const start = `${prefix}${recoveryScopeKey(scope)}:`;
  return (await entries<string, SavedOperation>())
    .filter(
      ([key, row]) =>
        row &&
        typeof key === 'string' &&
        key.startsWith(start) &&
        row.storeId === scope.storeId &&
        row.userId === scope.userId,
    )
    .map(([, row]) => row)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function acknowledgeOperation(row: SavedOperation) {
  // An uncertain operation must never be silently discarded or recreated.
  if (row.state === 'pending')
    throw new Error('Confirme o resultado antes de remover a tentativa.');
  await update<SavedOperation | undefined>(
    keyFor(row, row.kind, row.id),
    (saved) =>
      saved && saved.state !== 'pending'
        ? { ...saved, foregroundAcknowledged: true }
        : saved,
  );
  notify();
}

async function formFingerprint(form: FormData) {
  const parts: unknown[] = [];
  for (const [name, value] of form.entries()) {
    if (typeof value === 'string') parts.push([name, value]);
    else {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        await value.arrayBuffer(),
      );
      parts.push([
        name,
        value.name,
        value.type,
        value.size,
        Array.from(new Uint8Array(digest)),
      ]);
    }
  }
  return JSON.stringify(parts);
}

export async function submitRecoverableOperation(
  context: RecoveryContext,
  kind: OperationKind,
  id: string,
  label: string,
  form: FormData,
) {
  const key = keyFor(context, kind, id);
  let saved: SavedOperation | undefined;
  // Never persist session credentials. IndexedDB's transaction resolves before sending.
  try {
    const fingerprint = await formFingerprint(form);
    const candidate: SavedOperation = {
      storeId: context.storeId,
      userId: context.userId,
      id,
      kind,
      label,
      createdAt: Date.now(),
      state: 'pending',
      form: [...form.entries()],
      fingerprint,
    };
    await update<SavedOperation>(key, (existing) => {
      if (existing && existing.fingerprint !== fingerprint)
        throw new PendingOperationError(
          'Existe um envio anterior desta operação. Abra Envios para conferir o resultado antes de alterar os dados.',
        );
      saved = existing ?? candidate;
      return saved;
    });
  } catch (error) {
    if (error instanceof PendingOperationError) throw error;
    throw new Error(
      'Não foi possível guardar a operação neste aparelho. Libere espaço antes de confirmar; nenhum envio foi iniciado.',
    );
  }
  notify();
  if (!saved)
    throw new Error(
      'Não foi possível guardar o envio. Nenhum envio foi iniciado.',
    );
  const result = await recoverOperation(context, saved);
  // A foreground confirmation needs no permanent banner/history of routine successes.
  await update<SavedOperation | undefined>(key, (saved) =>
    saved?.state === 'confirmed'
      ? { ...saved, foregroundAcknowledged: true }
      : saved,
  ).catch(() => {});
  notify();
  return result;
}

export async function recoverOperation(
  context: RecoveryContext,
  row: SavedOperation,
): Promise<OperationResult> {
  if (row.storeId !== context.storeId || row.userId !== context.userId)
    throw new Error(
      'Entre na mesma conta e loja para recuperar esta operação.',
    );
  if (row.state === 'confirmed' && row.result) return row.result;
  if (row.state === 'rejected')
    throw new RejectedOperationError(
      row.error || 'Confira os dados antes de tentar novamente.',
    );
  const key = keyFor(row, row.kind, row.id);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = withLease(context, row).finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

async function withLease(context: RecoveryContext, row: SavedOperation) {
  const key = keyFor(row, row.kind, row.id);
  const owner = tabId();
  let acquired = false;
  let latest = row;
  await update<SavedOperation | undefined>(key, (saved) => {
    if (!saved) return saved;
    latest = saved;
    if (saved.state !== 'pending' || (saved.leaseUntil ?? 0) > Date.now())
      return saved;
    acquired = true;
    return { ...saved, leaseOwner: owner, leaseUntil: Date.now() + 420_000 };
  });
  if (latest.state === 'confirmed' && latest.result) return latest.result;
  if (!acquired)
    throw new PendingOperationError(
      'Outra aba está conferindo este envio. Aguarde a confirmação.',
    );
  try {
    return await recoverNow(context, latest);
  } finally {
    await update<SavedOperation | undefined>(key, (saved) =>
      saved?.leaseOwner === owner
        ? { ...saved, leaseOwner: undefined, leaseUntil: undefined }
        : saved,
    ).catch(() => {});
  }
}

async function recoverNow(context: RecoveryContext, row: SavedOperation) {
  const key = keyFor(row, row.kind, row.id);
  const statusUrl = `/api/operations?${new URLSearchParams({ kind: row.kind, id: row.id, actor: context.userId })}`;
  const confirm = async (result: OperationResult) => {
    if (result.id !== row.id)
      throw new Error('A confirmação não corresponde ao envio.');
    await update<SavedOperation | undefined>(key, (current) =>
      current
        ? { ...current, state: 'confirmed', result, form: [], error: undefined }
        : current,
    ).catch(() => {});
    window.dispatchEvent(
      new CustomEvent('pdv:operation-confirmed', {
        detail: {
          storeId: context.storeId,
          userId: context.userId,
          kind: row.kind,
          id: row.id,
          result,
        },
      }),
    );
    window.dispatchEvent(new Event('pdv:sales-changed'));
    notify();
    return result;
  };
  try {
    const lookup = await requestJson<{
      found: boolean;
      result?: OperationResult;
    }>(statusUrl);
    if (lookup.found && lookup.result) return await confirm(lookup.result);
    const form = new FormData();
    row.form.forEach(([name, value]) => form.append(name, value));
    try {
      const result = await requestJson<OperationResult>(
        row.kind === 'sale' ? '/api/sales' : '/api/entries',
        {
          method: 'POST',
          headers: { 'x-csrf-token': context.csrfToken },
          body: form,
        },
      );
      return await confirm(result);
    } catch (error) {
      // A lost response is not proof that the transaction failed.
      const after = await requestJson<{
        found: boolean;
        result?: OperationResult;
      }>(statusUrl);
      if (after.found && after.result) return await confirm(after.result);
      if (
        error instanceof ApiError &&
        ([400, 404, 409, 413, 415, 422].includes(error.status) ||
          (error.status === 403 && error.code === 'PERMISSION_DENIED'))
      ) {
        await update<SavedOperation | undefined>(key, (current) =>
          current
            ? { ...current, state: 'rejected', error: error.message, form: [] }
            : current,
        );
        window.dispatchEvent(
          new CustomEvent('pdv:operation-rejected', {
            detail: {
              storeId: context.storeId,
              userId: context.userId,
              kind: row.kind,
              id: row.id,
              error: error.message,
            },
          }),
        );
        notify();
        throw new RejectedOperationError(error.message);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof RejectedOperationError) throw error;
    await update<SavedOperation | undefined>(key, (current) =>
      current?.state === 'pending'
        ? {
            ...current,
            attempts: (current.attempts ?? 0) + 1,
            nextAttemptAt:
              Date.now() +
              Math.min(
                15 * 60_000,
                30_000 * 2 ** Math.min(current.attempts ?? 0, 5),
              ) +
              Math.floor(Math.random() * 5000),
          }
        : current,
    ).catch(() => {});
    throw new PendingOperationError(
      'Envio guardado neste aparelho, aguardando confirmação. Abra Envios para acompanhar. Não refaça a operação.',
    );
  }
}
