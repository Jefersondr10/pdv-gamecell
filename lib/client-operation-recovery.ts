'use client';

import { entries, update } from 'idb-keyval';
import { ApiError, messageOf, requestJson } from './client-api.ts';

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
  options: { checkWhileLeased?: boolean } = {},
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
  const task = withLease(context, row, options.checkWhileLeased).finally(() =>
    inFlight.delete(key),
  );
  inFlight.set(key, task);
  return task;
}

export type RecoveryOutcome = {
  row: SavedOperation;
  state: 'confirmed' | 'pending' | 'rejected';
  error?: string;
};

export async function recoverPendingOperations(
  context: RecoveryContext,
  options: {
    manual?: boolean;
    shouldContinue?: () => boolean;
    onProgress?: (row: SavedOperation, index: number, total: number) => void;
    onSettled?: (outcome: RecoveryOutcome) => void;
  } = {},
) {
  const pending = (await listOperations(context)).filter(
    (row) =>
      row.state === 'pending' &&
      (options.manual || (row.nextAttemptAt ?? 0) <= Date.now()),
  );
  const outcomes: RecoveryOutcome[] = [];
  for (const [index, row] of pending.entries()) {
    if (options.shouldContinue?.() === false) break;
    options.onProgress?.(row, index + 1, pending.length);
    let outcome: RecoveryOutcome;
    try {
      await recoverOperation(context, row, {
        checkWhileLeased: options.manual,
      });
      outcome = { row, state: 'confirmed' };
    } catch (error) {
      outcome = {
        row,
        state: error instanceof RejectedOperationError ? 'rejected' : 'pending',
        error: messageOf(error),
      };
    }
    outcomes.push(outcome);
    options.onSettled?.(outcome);
  }
  return outcomes;
}

async function withLease(
  context: RecoveryContext,
  row: SavedOperation,
  checkWhileLeased = false,
) {
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
  if (latest.state === 'rejected')
    throw new RejectedOperationError(
      latest.error || 'Confira os dados antes de tentar novamente.',
    );
  if (!acquired) {
    // Mobile reloads can leave a lease behind after the server has committed.
    // A manual check can confirm it immediately, but must NEVER resend while
    // another tab still owns the upload lease.
    if (checkWhileLeased) {
      try {
        const result = await lookupOperation(context, latest);
        if (result) return await confirmOperation(context, latest, result);
      } catch (error) {
        throw new PendingOperationError(recoveryFailureMessage(error));
      }
    }
    const seconds = Math.max(
      1,
      Math.ceil(((latest.leaseUntil ?? Date.now()) - Date.now()) / 1000),
    );
    throw new PendingOperationError(
      `Um envio anterior ainda pode estar em andamento. Nova tentativa em até ${Math.ceil(seconds / 60)} min; não refaça a operação.`,
    );
  }
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

function recoveryFailureMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.code === 'BAD_CSRF')
      return 'Sua sessão precisa ser renovada. Entre novamente na mesma conta e loja; o envio está guardado.';
    if (error.code === 'PASSWORD_CHANGE_REQUIRED')
      return 'Atualize sua senha para retomar. O envio está guardado neste aparelho.';
    if (error.status === 429)
      return 'O servidor pediu uma pausa. Aguarde um pouco e tente conferir novamente.';
  }
  if (error instanceof TypeError)
    return 'Não foi possível conectar ao servidor. Confira a internet e tente novamente; o envio está guardado.';
  return `${messageOf(error)} O envio continua guardado; não refaça a operação.`;
}

async function lookupOperation(context: RecoveryContext, row: SavedOperation) {
  const statusUrl = `/api/operations?${new URLSearchParams({ kind: row.kind, id: row.id, actor: context.userId })}`;
  const lookup = await requestJson<{
    found: boolean;
    result?: OperationResult;
  }>(statusUrl);
  return lookup.found && lookup.result ? lookup.result : null;
}

async function confirmOperation(
  context: RecoveryContext,
  row: SavedOperation,
  result: OperationResult,
) {
  const key = keyFor(row, row.kind, row.id);
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
}

async function recoverNow(context: RecoveryContext, row: SavedOperation) {
  const key = keyFor(row, row.kind, row.id);
  try {
    const found = await lookupOperation(context, row);
    if (found) return await confirmOperation(context, row, found);
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
      return await confirmOperation(context, row, result);
    } catch (error) {
      // A lost response is not proof that the transaction failed.
      const after = await lookupOperation(context, row);
      if (after) return await confirmOperation(context, row, after);
      if (
        error instanceof ApiError &&
        (([400, 404, 409, 413, 415, 422].includes(error.status) &&
          error.code !== 'INVALID_MULTIPART') ||
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
    const failure = recoveryFailureMessage(error);
    await update<SavedOperation | undefined>(key, (current) =>
      current?.state === 'pending'
        ? {
            ...current,
            error: failure,
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
    notify();
    throw new PendingOperationError(failure);
  }
}
