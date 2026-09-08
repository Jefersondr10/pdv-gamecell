import { prepareUploadForm } from './client-upload.ts';

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
    const multipart = init?.body instanceof FormData;
    const headers = multipart ? new Headers(init?.headers) : init?.headers;
    if (multipart && headers instanceof Headers) headers.delete('content-type');
    const body =
      init?.body instanceof FormData
        ? await prepareUploadForm(init.body, controller.signal)
        : init?.body;
    const response = await fetch(url, {
      ...init,
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    const responseBody = (await response.json().catch(() => ({}))) as {
      code?: string;
      details?: unknown;
      error?: string;
    } & T;
    if (!response.ok) {
      throw new ApiError(
        responseBody.error || 'Não foi possível concluir a operação.',
        response.status,
        responseBody.code,
        responseBody.details,
      );
    }
    return responseBody;
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
