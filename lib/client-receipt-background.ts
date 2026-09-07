'use client';

export type ReceiptOcrAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
};

type ReceiptOcrJob = ReceiptOcrAttachment & {
  attempts: number;
  createdAt: number;
  nextAttemptAt: number;
  operationId: string;
  saleId: string;
  storeId: string;
};

type ReceiptOcrContext = {
  csrfToken: string;
  onUpdated?: () => void | Promise<void>;
  storeId: string;
};

type ReceiptValue = { amountCents: number | null };

const QUEUE_KEY_PREFIX = 'atacadoapple:receipt-ocr:v1';
const MAX_ATTEMPTS = 3;
const RETRY_START_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;

let activeContext: (ReceiptOcrContext & { generation: number }) | null = null;
let contextGeneration = 0;
let runner: Promise<void> | null = null;
let rerunRequested = false;
let retryTimer: number | null = null;
let storageTail: Promise<unknown> = Promise.resolve();
let persistentStorageAvailable = true;
const memoryJobs = new Map<string, ReceiptOcrJob[]>();
const sourceFiles = new Map<string, File>();

class PermanentJobError extends Error {}
class QueuePausedError extends Error {}

export function activateReceiptOcrQueue(context: ReceiptOcrContext) {
  const generation = ++contextGeneration;
  activeContext = { ...context, generation };
  const resume = () => scheduleRunner();
  window.addEventListener('online', resume);
  scheduleRunner();
  return () => {
    window.removeEventListener('online', resume);
    if (activeContext?.generation === generation) activeContext = null;
  };
}

export async function enqueueReceiptOcrJobs(input: {
  attachments: readonly ReceiptOcrAttachment[];
  files?: readonly File[];
  receiptValues?: readonly ReceiptValue[];
  saleId: string;
  storeId: string;
}) {
  const now = Date.now();
  const incoming = input.attachments.flatMap((attachment, index) => {
    if ((input.receiptValues?.[index]?.amountCents ?? null) !== null) return [];
    const id = jobId(input.storeId, input.saleId, attachment.id);
    const file = input.files?.[index];
    if (file) sourceFiles.set(id, file);
    else sourceFiles.delete(id);
    return [
      {
        ...attachment,
        attempts: 0,
        createdAt: now,
        nextAttemptAt: now,
        operationId: crypto.randomUUID(),
        saleId: input.saleId,
        storeId: input.storeId,
      } satisfies ReceiptOcrJob,
    ];
  });
  if (incoming.length === 0) return;

  await updateJobs(input.storeId, (current) => {
    const byId = new Map(current.map((job) => [jobIdOf(job), job]));
    for (const job of incoming) {
      const existing = byId.get(jobIdOf(job));
      byId.set(jobIdOf(job), existing ? { ...job, ...existing } : job);
    }
    return [...byId.values()];
  });
  scheduleRunner();
}

function scheduleRunner(delay = 0) {
  if (!activeContext || typeof window === 'undefined') return;
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (delay > 0) {
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      void ensureRunner();
    }, delay);
    return;
  }
  rerunRequested = true;
  queueMicrotask(() => void ensureRunner());
}

async function ensureRunner() {
  if (runner || !activeContext) return;
  rerunRequested = false;
  runner = runQueue().finally(() => {
    runner = null;
    if (rerunRequested) scheduleRunner();
  });
  await runner;
}

async function runQueue() {
  while (activeContext) {
    const context = activeContext;
    const jobs = await readJobs(context.storeId);
    const next = jobs
      .filter((job) => job.storeId === context.storeId)
      .sort(
        (left, right) =>
          left.nextAttemptAt - right.nextAttemptAt ||
          left.createdAt - right.createdAt,
      )[0];
    if (!next) return;
    const waitMs = next.nextAttemptAt - Date.now();
    if (waitMs > 0) {
      scheduleRunner(Math.min(waitMs, RETRY_MAX_MS));
      return;
    }
    if (navigator.onLine === false) return;

    try {
      const updated = await processJob(next, context);
      await removeJob(next);
      sourceFiles.delete(jobIdOf(next));
      if (updated) notifySalesChanged(context);
    } catch (error) {
      if (error instanceof QueuePausedError) return;
      if (error instanceof PermanentJobError) {
        await removeJob(next);
        sourceFiles.delete(jobIdOf(next));
        continue;
      }
      if (next.attempts + 1 >= MAX_ATTEMPTS) {
        await removeJob(next);
        sourceFiles.delete(jobIdOf(next));
        continue;
      }
      await postponeJob(next);
    }
  }
}

async function processJob(job: ReceiptOcrJob, context: ReceiptOcrContext) {
  const file = sourceFiles.get(jobIdOf(job)) ?? (await downloadReceipt(job));
  const { readReceiptAmount } = await import('@/lib/client-receipt-ocr');
  const suggestion = await readReceiptAmount(file);
  if (!suggestion) return false;

  const current = activeContext;
  if (!current || current.storeId !== job.storeId) throw new QueuePausedError();
  const response = await fetch(`/api/sales/${job.saleId}/receipt-values`, {
    method: 'PATCH',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': current.csrfToken || context.csrfToken,
    },
    body: JSON.stringify({
      operationId: job.operationId,
      onlyIfPending: true,
      receipts: [
        { id: job.id, amountCents: suggestion.amountCents, source: 'ocr' },
      ],
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    code?: string;
    error?: string;
  };
  if (!response.ok) {
    if (
      body.code === 'SALE_CANCELLED' ||
      body.code === 'SALE_NOT_FOUND' ||
      body.code === 'RECEIPT_NOT_FOUND' ||
      body.code === 'SALE_CHANGED'
    ) {
      throw new PermanentJobError(body.error);
    }
    throw new Error(body.error || 'Não foi possível salvar a leitura.');
  }
  return true;
}

async function downloadReceipt(job: ReceiptOcrJob) {
  const response = await fetch(job.url, {
    credentials: 'same-origin',
  });
  if (response.status === 404 || response.status === 410) {
    throw new PermanentJobError('O comprovante não está mais disponível.');
  }
  if (!response.ok) {
    throw new Error('Não foi possível carregar o comprovante para leitura.');
  }
  const blob = await response.blob();
  return new File([blob], job.name || 'comprovante', {
    type: job.mimeType || blob.type,
  });
}

function notifySalesChanged(context: ReceiptOcrContext) {
  window.dispatchEvent(new Event('pdv:sales-changed'));
  void Promise.resolve(context.onUpdated?.()).catch(() => {});
}

async function postponeJob(job: ReceiptOcrJob) {
  const attempts = job.attempts + 1;
  const retryMs = Math.min(
    RETRY_START_MS * 2 ** Math.min(attempts - 1, 7),
    RETRY_MAX_MS,
  );
  await updateJobs(job.storeId, (jobs) =>
    jobs.map((candidate) =>
      jobIdOf(candidate) === jobIdOf(job)
        ? {
            ...candidate,
            attempts,
            nextAttemptAt: Date.now() + retryMs,
          }
        : candidate,
    ),
  );
}

async function removeJob(job: ReceiptOcrJob) {
  await updateJobs(job.storeId, (jobs) =>
    jobs.filter((candidate) => jobIdOf(candidate) !== jobIdOf(job)),
  );
}

function readJobs(storeId: string) {
  return withStorageLock(() => readJobsUnlocked(storeId));
}

function updateJobs(
  storeId: string,
  update: (jobs: ReceiptOcrJob[]) => ReceiptOcrJob[],
) {
  return withStorageLock(async () => {
    const next = update(await readJobsUnlocked(storeId));
    memoryJobs.set(storeId, next);
    if (!persistentStorageAvailable) return;
    try {
      const { del, set } = await import('idb-keyval');
      if (next.length === 0) await del(storageKey(storeId));
      else await set(storageKey(storeId), next);
    } catch {
      persistentStorageAvailable = false;
    }
  });
}

async function readJobsUnlocked(storeId: string): Promise<ReceiptOcrJob[]> {
  if (!persistentStorageAvailable) return memoryJobs.get(storeId) ?? [];
  try {
    const { get } = await import('idb-keyval');
    const stored = await get<unknown>(storageKey(storeId));
    const jobs = Array.isArray(stored) ? stored.filter(isReceiptOcrJob) : [];
    memoryJobs.set(storeId, jobs);
    return jobs;
  } catch {
    persistentStorageAvailable = false;
    return memoryJobs.get(storeId) ?? [];
  }
}

function withStorageLock<T>(operation: () => Promise<T>) {
  const result = storageTail.then(operation, operation);
  storageTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function isReceiptOcrJob(value: unknown): value is ReceiptOcrJob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const job = value as Partial<ReceiptOcrJob>;
  return (
    typeof job.id === 'string' &&
    typeof job.name === 'string' &&
    typeof job.mimeType === 'string' &&
    typeof job.sizeBytes === 'number' &&
    typeof job.url === 'string' &&
    typeof job.attempts === 'number' &&
    typeof job.createdAt === 'number' &&
    typeof job.nextAttemptAt === 'number' &&
    typeof job.operationId === 'string' &&
    typeof job.saleId === 'string' &&
    typeof job.storeId === 'string'
  );
}

function storageKey(storeId: string) {
  return `${QUEUE_KEY_PREFIX}:${storeId}`;
}

function jobId(storeId: string, saleId: string, receiptId: string) {
  return `${storeId}:${saleId}:${receiptId}`;
}

function jobIdOf(job: ReceiptOcrJob) {
  return jobId(job.storeId, job.saleId, job.id);
}
