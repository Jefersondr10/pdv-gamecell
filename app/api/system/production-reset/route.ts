import {
  apiError,
  assertJsonRequest,
  assertSameOrigin,
  boundedJson,
  HttpError,
  json,
} from '@/lib/server/http';
import {
  PRODUCTION_READY_MARKER,
  PRODUCTION_RESET_MARKER,
} from '@/lib/server/production-readiness';
import { runtime } from '@/lib/server/runtime';
import { timingSafeEqual } from '@/lib/server/security';
import { PRODUCTION_RESET_DELETE_ORDER } from '@/lib/server/database-lifecycle';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const supplied = request.headers.get('x-production-reset-token') ?? '';
    const expected = runtime().PRODUCTION_RESET_SECRET_V1?.trim() ?? '';
    if (
      runtime().PRODUCTION_MAINTENANCE !== '1' ||
      !expected ||
      !supplied ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new HttpError(404, 'Recurso não encontrado.', 'NOT_FOUND');
    }
    const db = runtime().DB;
    const body = (await boundedJson(request, 2048)) as {
      cursor?: unknown;
      restart?: unknown;
    };
    const restart = body.restart === true;
    if (restart) {
      await resetDatabase(db);
    } else {
      const marker = await db
        .prepare('SELECT 1 FROM login_attempts WHERE key_hash = ? LIMIT 1')
        .bind(PRODUCTION_RESET_MARKER)
        .first();
      if (!marker) {
        throw new HttpError(
          410,
          'A limpeza inicial já foi concluída.',
          'RESET_COMPLETE',
        );
      }
    }
    const cursor =
      !restart && typeof body.cursor === 'string' && body.cursor.length <= 500
        ? body.cursor
        : undefined;
    const listed = await runtime().FILES.list({
      prefix: 'stores/',
      limit: 1000,
      cursor,
    });
    if (listed.objects.length) {
      await runtime().FILES.delete(listed.objects.map((object) => object.key));
    }
    if (!listed.truncated) {
      const now = Date.now();
      await db.batch([
        db
          .prepare('DELETE FROM login_attempts WHERE key_hash = ?')
          .bind(PRODUCTION_RESET_MARKER),
        db
          .prepare(
            `INSERT INTO login_attempts
             (key_hash, attempts, blocked_until, updated_at)
             VALUES (?, 0, NULL, ?)
             ON CONFLICT(key_hash) DO UPDATE SET
               attempts = 0, blocked_until = NULL,
               updated_at = excluded.updated_at`,
          )
          .bind(PRODUCTION_READY_MARKER, now),
      ]);
    }
    return json({
      deleted: listed.objects.length,
      complete: !listed.truncated,
      cursor: listed.truncated ? listed.cursor : null,
    });
  } catch (error) {
    return apiError(error);
  }
}

async function resetDatabase(db: D1Database) {
  const now = Date.now();
  await db.batch([
    db.prepare(`DELETE FROM "${PRODUCTION_RESET_DELETE_ORDER[0]}"`),
    db
      .prepare(
        `INSERT INTO login_attempts
         (key_hash, attempts, blocked_until, updated_at)
         VALUES (?, 0, NULL, ?)`,
      )
      .bind(PRODUCTION_RESET_MARKER, now),
    ...PRODUCTION_RESET_DELETE_ORDER.slice(1).map((table) =>
      db.prepare(`DELETE FROM "${table}"`),
    ),
  ]);
}
