export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'REQUEST_ERROR',
    public details?: unknown,
  ) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function apiError(error: unknown) {
  if (error instanceof HttpError) {
    return json(
      { error: error.message, code: error.code, details: error.details },
      { status: error.status },
    );
  }
  console.error('API error', error instanceof Error ? error.message : error);
  return json(
    { error: 'Não foi possível concluir a operação.', code: 'INTERNAL_ERROR' },
    { status: 500 },
  );
}

export function assertJsonRequest(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(
      415,
      'Formato de envio não aceito.',
      'BAD_CONTENT_TYPE',
    );
  }
}

export async function boundedJson(
  request: Request,
  maxBytes = 32 * 1024,
): Promise<Record<string, unknown>> {
  assertJsonRequest(request);
  if (!request.body) {
    throw new HttpError(400, 'Dados da solicitação ausentes.', 'INVALID_JSON');
  }
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new HttpError(413, 'Solicitação muito grande.', 'PAYLOAD_TOO_LARGE');
  }
  const reader = request.body.getReader();
  let received = 0;
  let exceeded = false;
  const limitedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        controller.close();
        return;
      }
      received += chunk.value.byteLength;
      if (received > maxBytes) {
        exceeded = true;
        await reader.cancel('json limit exceeded');
        controller.error(new Error('json limit exceeded'));
        return;
      }
      controller.enqueue(chunk.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  let parsed: unknown;
  try {
    parsed = await new Response(limitedBody, {
      headers: { 'content-type': 'application/json' },
    }).json();
  } catch {
    if (exceeded) {
      throw new HttpError(
        413,
        'Solicitação muito grande.',
        'PAYLOAD_TOO_LARGE',
      );
    }
    throw new HttpError(400, 'JSON inválido.', 'INVALID_JSON');
  }
  return asJsonObject(parsed);
}

export function parseJsonObject(
  value: string,
  message = 'Dados enviados inválidos.',
  code = 'INVALID_PAYLOAD',
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(400, message, code);
  }
  return asJsonObject(parsed, message, code);
}

function asJsonObject(
  value: unknown,
  message = 'JSON inválido.',
  code = 'INVALID_JSON',
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, message, code);
  }
  return value as Record<string, unknown>;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const expected = new URL(request.url).origin;
  if (origin !== expected) {
    throw new HttpError(
      403,
      'Origem da solicitação não permitida.',
      'BAD_ORIGIN',
    );
  }
}

export function stringField(
  value: unknown,
  label: string,
  options: { min?: number; max?: number } = {},
) {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${label} inválido.`, 'INVALID_FIELD');
  }
  const normalized = value.trim();
  const min = options.min ?? 1;
  const max = options.max ?? 200;
  if (normalized.length < min || normalized.length > max) {
    throw new HttpError(400, `${label} inválido.`, 'INVALID_FIELD');
  }
  return normalized;
}

export function passwordField(value: unknown) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new HttpError(400, 'Senha inválida.', 'INVALID_PASSWORD');
  }
  return value;
}

export function integerField(
  value: unknown,
  label: string,
  options: { min?: number; max?: number } = {},
) {
  const min = options.min ?? 0;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < min ||
    Number(value) > max
  ) {
    throw new HttpError(400, `${label} inválido.`, 'INVALID_FIELD');
  }
  return Number(value);
}

export function utf8Prefix(value: string, maxBytes: number) {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;
  let result = '';
  let used = 0;
  for (const character of value) {
    const size = encoder.encode(character).byteLength;
    if (used + size > maxBytes) break;
    result += character;
    used += size;
  }
  return result;
}

export function readCookies(request: Request) {
  const cookies = new Map<string, string>();
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    cookies.set(
      part.slice(0, separator).trim(),
      decodeURIComponent(part.slice(separator + 1).trim()),
    );
  }
  return cookies;
}

export function cookieHeader(
  name: string,
  value: string,
  options: {
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Lax' | 'Strict';
  } = {},
) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join('; ');
}
