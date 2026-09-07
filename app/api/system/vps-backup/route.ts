import { apiError, HttpError, json } from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import { timingSafeEqual } from '@/lib/server/security';
import { BACKUP_LATE_MS } from '@/lib/backup-status';

export const dynamic = 'force-dynamic';

async function backupHealthTime() {
  try {
    const object = await runtime().FILES.get('vps-backup-health/latest.json');
    const value = object
      ? (await object.json<{ acceptedAt?: unknown }>()).acceptedAt
      : null;
    return typeof value === 'number' &&
      Number.isFinite(value) &&
      value > 0 &&
      value <= Date.now() + 60_000
      ? value
      : null;
  } catch {
    return null;
  }
}

async function recordSnapshotTime(acceptedAt: number) {
  const previous = await backupHealthTime();
  if (
    Number.isFinite(acceptedAt) &&
    acceptedAt > 0 &&
    acceptedAt > (previous ?? 0)
  )
    await runtime().FILES.put(
      'vps-backup-health/latest.json',
      JSON.stringify({ acceptedAt, version: 1 }),
      { httpMetadata: { contentType: 'application/json' } },
    );
}

function authenticate(request: Request) {
  const secret = runtime().VPS_BACKUP_TOKEN ?? '';
  if (
    secret.length < 43 ||
    !timingSafeEqual(
      request.headers.get('authorization') ?? '',
      `Bearer ${secret}`,
    )
  ) {
    throw new HttpError(404, 'Recurso não encontrado.', 'NOT_FOUND');
  }
}
function objectKey(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  const hash = url.searchParams.get('hash');
  if (
    !['objects', 'snapshots'].includes(kind ?? '') ||
    !/^[a-f0-9]{64}$/.test(hash ?? '')
  )
    throw new HttpError(400, 'Identificador inválido.', 'INVALID_BACKUP');
  return `vps-backups/${kind}/${hash}`;
}

export async function POST(request: Request) {
  try {
    authenticate(request);
    const key = objectKey(request);
    const limit = 16 * 1024 * 1024;
    if (!request.body || Number(request.headers.get('content-length')) > limit)
      throw new HttpError(413, 'Backup muito grande.', 'TOO_LARGE');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, 'Backup muito grande.', 'TOO_LARGE');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    )
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (!key.endsWith(`/${digest}`))
      throw new HttpError(
        400,
        'Integridade do backup inválida.',
        'HASH_MISMATCH',
      );
    // Content-addressed, append-only. This credential cannot delete or replace
    // an earlier backup with different bytes, even if the VPS is compromised.
    const existing = await runtime().FILES.get(key);
    if (existing) {
      await existing.body.cancel();
      // Repair a failed marker write using the ORIGINAL upload time. Replays
      // must not make an old snapshot look new or replace a newer heartbeat.
      if (key.startsWith('vps-backups/snapshots/'))
        await recordSnapshotTime(existing.uploaded.getTime());
      return json({ ok: true, existing: true });
    }
    await runtime().FILES.put(key, bytes, {
      httpMetadata: { contentType: 'application/octet-stream' },
    });
    if (key.startsWith('vps-backups/snapshots/'))
      await recordSnapshotTime(Date.now());
    return json({ ok: true }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get('health') === '1') {
      const secret = runtime().VPS_BACKUP_MONITOR_TOKEN ?? '';
      if (
        secret.length < 43 ||
        secret === runtime().VPS_BACKUP_TOKEN ||
        !timingSafeEqual(
          request.headers.get('authorization') ?? '',
          `Bearer ${secret}`,
        )
      )
        throw new HttpError(404, 'Recurso não encontrado.', 'NOT_FOUND');
      const acceptedAt = await backupHealthTime();
      const healthy =
        acceptedAt !== null && Date.now() - acceptedAt < BACKUP_LATE_MS;
      return json({ ok: Boolean(healthy) }, { status: healthy ? 200 : 503 });
    }
    authenticate(request);
    const url = new URL(request.url);
    if (url.searchParams.get('list') === 'snapshots') {
      const cursor = url.searchParams.get('cursor') ?? undefined;
      if (cursor && cursor.length > 1000)
        throw new HttpError(400, 'Cursor inválido.');
      const listed = await runtime().FILES.list({
        prefix: 'vps-backups/snapshots/',
        limit: 100,
        cursor,
      });
      return json({
        snapshots: listed.objects.map(({ key, uploaded, size }) => ({
          hash: key.split('/').at(-1),
          uploaded,
          size,
        })),
        cursor: listed.truncated ? listed.cursor : null,
      });
    }
    const object = await runtime().FILES.get(objectKey(request));
    if (!object)
      throw new HttpError(404, 'Backup não encontrado.', 'NOT_FOUND');
    return new Response(object.body, {
      headers: {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function HEAD(request: Request) {
  try {
    authenticate(request);
    const object = await runtime().FILES.get(objectKey(request));
    if (!object) return new Response(null, { status: 404 });
    await object.body.cancel();
    return new Response(null, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
