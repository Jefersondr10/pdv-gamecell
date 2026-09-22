'use client';

import { entries, update } from 'idb-keyval';
import { ApiError, messageOf, requestJson } from './client-api.ts';
import {
  readUploadFile,
  UnreadableAttachmentError,
  type AttachmentIssue,
} from './client-upload.ts';

type SavedFileCopy = {
  index: number;
  name: string;
  type: string;
  lastModified: number;
  bytes: ArrayBuffer;
};

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
  // Raw bytes survive loss of a browser-managed temporary File handle.
  // Keep form compatible with older tabs while they finish updating.
  fileCopies?: SavedFileCopy[];
  attachmentIssue?: AttachmentIssue;
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

async function prepareSavedForm(form: FormData) {
  const parts: unknown[] = [];
  const savedForm: SavedOperation['form'] = [];
  const fileCopies: SavedFileCopy[] = [];
  for (const [index, [name, value]] of [...form.entries()].entries()) {
    savedForm.push([name, value]);
    if (typeof value === 'string') parts.push([name, value]);
    else {
      const bytes = await readUploadFile(value, {
        index,
        field: name,
        name: value.name || 'anexo',
      });
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      fileCopies.push({
        index,
        name: value.name,
        type: value.type,
        lastModified: value.lastModified,
        bytes,
      });
      savedForm[index] = [
        name,
        new File([bytes], value.name, {
          type: value.type,
          lastModified: value.lastModified,
        }),
      ];
      parts.push([
        name,
        value.name,
        value.type,
        value.size,
        Array.from(new Uint8Array(digest)),
      ]);
    }
  }
  return { fingerprint: JSON.stringify(parts), form: savedForm, fileCopies };
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
    const prepared = await prepareSavedForm(form);
    const candidate: SavedOperation = {
      storeId: context.storeId,
      userId: context.userId,
      id,
      kind,
      label,
      createdAt: Date.now(),
      state: 'pending',
      ...prepared,
    };
    await update<SavedOperation>(key, (existing) => {
      if (existing && existing.fingerprint !== prepared.fingerprint)
        throw new PendingOperationError(
          'Existe um envio anterior desta operação. Abra Envios para conferir o resultado antes de alterar os dados.',
        );
      saved = existing ?? candidate;
      return saved;
    });
  } catch (error) {
    if (error instanceof PendingOperationError) throw error;
    if (error instanceof UnreadableAttachmentError)
      throw new Error(`${error.message} Nenhum envio foi iniciado.`);
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
  const { key, owner, acquired, latest } = await claimLease(row);
  if (latest.state === 'confirmed' && latest.result) return latest.result;
  if (latest.state === 'rejected')
    throw new RejectedOperationError(
      latest.error || 'Confira os dados antes de tentar novamente.',
    );
  if (!acquired) {
    // A manual lookup can confirm a committed upload without stealing its lease.
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
    await releaseLease(key, owner);
  }
}

async function claimLease(row: SavedOperation) {
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
  return { key, owner, acquired, latest };
}

async function releaseLease(key: string, owner: string) {
  await update<SavedOperation | undefined>(key, (saved) =>
    saved?.leaseOwner === owner
      ? { ...saved, leaseOwner: undefined, leaseUntil: undefined }
      : saved,
  ).catch(() => {});
}

export async function replaceOperationAttachment(
  context: RecoveryContext,
  row: SavedOperation,
  index: number,
  replacement: File,
): Promise<{ confirmed: boolean }> {
  if (row.storeId !== context.storeId || row.userId !== context.userId)
    throw new Error('Entre na mesma conta e loja para corrigir este anexo.');
  const { key, owner, acquired, latest } = await claimLease(row);
  try {
    if (latest.state === 'confirmed') return { confirmed: true };
    if (latest.state !== 'pending')
      throw new Error('Este envio não está pendente. Reabra Envios.');
    // Always check the server before touching the saved payload. Confirmation
    // wins over a replacement, including a commit whose response was lost.
    const found = await lookupOperation(context, latest);
    if (found) {
      await confirmOperation(context, latest, found);
      return { confirmed: true };
    }
    if (!acquired)
      throw new PendingOperationError(
        'Há um envio em andamento. Aguarde antes de corrigir o anexo.',
      );
    if (latest.fingerprint !== row.fingerprint)
      throw new Error(
        'Os anexos mudaram em outra aba. Reabra Envios para conferir.',
      );
    const original = latest.form[index];
    if (
      !Number.isInteger(index) ||
      !original ||
      typeof original[1] === 'string'
    )
      throw new Error('Anexo não encontrado. Reabra Envios.');
    const [field] = original;
    const type = replacement.type.toLowerCase();
    if (
      !(
        new Set([
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/heic',
          'image/heif',
        ]).has(type) ||
        (field === 'receipts' && type === 'application/pdf')
      ) ||
      replacement.size <= 0 ||
      replacement.size > 10 * 1024 * 1024
    )
      throw new Error(
        field === 'receipts'
          ? 'Selecione uma imagem ou PDF de até 10 MB.'
          : 'Selecione uma foto de até 10 MB.',
      );
    const total = latest.form.reduce(
      (sum, [, value], position) =>
        sum +
        (position === index
          ? replacement.size
          : typeof value === 'string'
            ? 0
            : value.size),
      0,
    );
    if (total > 45 * 1024 * 1024)
      throw new Error(
        'Os anexos ultrapassam 45 MB. Selecione um arquivo menor.',
      );
    const bytes = await readUploadFile(replacement, {
      index,
      field,
      name: replacement.name || 'anexo',
    });
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    );
    const parts: unknown = JSON.parse(latest.fingerprint);
    if (
      !Array.isArray(parts) ||
      parts.length !== latest.form.length ||
      !Array.isArray(parts[index]) ||
      parts[index][0] !== field
    )
      throw new Error(
        'Não foi possível validar este anexo. Os dados originais foram preservados.',
      );
    parts[index] = [field, replacement.name, type, bytes.byteLength, digest];
    const fingerprint = JSON.stringify(parts);
    const materialized = new File([bytes], replacement.name, {
      type,
      lastModified: replacement.lastModified,
    });
    await update<SavedOperation | undefined>(key, (current) => {
      if (
        !current ||
        current.state !== 'pending' ||
        current.leaseOwner !== owner ||
        current.fingerprint !== latest.fingerprint
      )
        throw new Error(
          'O envio mudou durante a correção. Reabra Envios antes de tentar novamente.',
        );
      const form = [...current.form];
      form[index] = [field, materialized];
      return {
        ...current,
        form,
        fingerprint,
        fileCopies: [
          ...(current.fileCopies ?? []).filter((copy) => copy.index !== index),
          {
            index,
            name: replacement.name,
            type,
            lastModified: replacement.lastModified,
            bytes,
          },
        ],
        error: undefined,
        attachmentIssue: undefined,
        nextAttemptAt: 0,
        attempts: 0,
      };
    });
    notify();
    return { confirmed: false };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError')
      throw new Error(
        'Não foi possível guardar o novo anexo. Libere espaço no aparelho sem limpar os dados deste aplicativo e tente novamente; o envio original foi preservado.',
      );
    if (error instanceof ApiError || error instanceof TypeError)
      throw new PendingOperationError(recoveryFailureMessage(error));
    throw error;
  } finally {
    if (acquired) await releaseLease(key, owner);
  }
}

function recoveryFailureMessage(error: unknown) {
  if (error instanceof UnreadableAttachmentError)
    return `${error.message} Use a opção Corrigir anexo abaixo; o envio continua guardado.`;
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
      ? {
          ...current,
          state: 'confirmed',
          result,
          form: [],
          fileCopies: [],
          attachmentIssue: undefined,
          error: undefined,
        }
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
    row.form.forEach(([name, value], index) => {
      const copy = row.fileCopies?.find((file) => file.index === index);
      if (typeof value !== 'string' && copy) {
        if (
          !(copy.bytes instanceof ArrayBuffer) ||
          copy.bytes.byteLength !== value.size
        )
          throw new UnreadableAttachmentError({
            index,
            field: name,
            name: copy.name,
          });
        form.append(
          name,
          new File([copy.bytes], copy.name, {
            type: copy.type,
            lastModified: copy.lastModified,
          }),
        );
      } else form.append(name, value);
    });
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
            ? {
                ...current,
                state: 'rejected',
                error: error.message,
                form: [],
                fileCopies: [],
                attachmentIssue: undefined,
              }
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
            attachmentIssue:
              error instanceof UnreadableAttachmentError
                ? error.attachment
                : current.attachmentIssue,
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
