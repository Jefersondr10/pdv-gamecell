export async function requestJson<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    init?.body instanceof FormData ? 180_000 : 60_000,
  );
  const forwardAbort = () => controller.abort();
  if (init?.signal?.aborted) controller.abort();
  else init?.signal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const response = await fetch(url, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      details?: unknown;
      error?: string;
    } & T;
    if (!response.ok) {
      throw new ApiError(
        body.error || 'Não foi possível concluir a operação.',
        response.status,
        body.code,
        body.details,
      );
    }
    return body;
  } catch (error) {
    if (timedOut) {
      throw new Error(
        'A operação demorou demais. Confira sua conexão e tente novamente.',
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    init?.signal?.removeEventListener('abort', forwardAbort);
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function messageOf(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Não foi possível concluir a operação.';
}
