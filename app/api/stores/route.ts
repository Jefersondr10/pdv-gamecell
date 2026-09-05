import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  apiError,
  assertJsonRequest,
  assertSameOrigin,
  boundedJson,
  HttpError,
  json,
  stringField,
} from '@/lib/server/http';
import { consumeFixedWindowLimits } from '@/lib/server/rate-limit';
import { assertPrimaryStoreAccess } from '@/lib/server/primary-store';
import { runtime } from '@/lib/server/runtime';
import { normalizeStoreCode } from '@/lib/server/security';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const session = await requireSession(request, {
      store: false,
      roles: ['owner'],
    });
    assertCsrf(request, session);
    if (session.storeId) {
      throw new HttpError(
        409,
        'Esta conta já possui uma loja.',
        'STORE_EXISTS',
      );
    }
    const body = (await boundedJson(request)) as Record<string, unknown>;
    const name = stringField(body.name, 'Nome da loja', { max: 100 });
    const code = normalizeStoreCode(
      stringField(body.code ?? name, 'Código da loja', { max: 80 }),
    );
    if (code.length < 3) {
      throw new HttpError(
        400,
        'O código da loja deve ter ao menos 3 caracteres.',
        'INVALID_STORE_CODE',
      );
    }
    assertPrimaryStoreAccess(code, body.setupToken);
    const db = runtime().DB;
    const now = Date.now();
    const sourceIp = request.headers.get('cf-connecting-ip') ?? 'unknown';
    await consumeFixedWindowLimits(
      db,
      now,
      [
        {
          scope: 'store-create:global:hour',
          windowMs: 60 * 60 * 1000,
          max: 100,
          global: true,
        },
        {
          scope: 'store-create:global:day',
          windowMs: 24 * 60 * 60 * 1000,
          max: 500,
          global: true,
        },
        {
          scope: `store-create:user:${session.id}`,
          windowMs: 24 * 60 * 60 * 1000,
          max: 5,
        },
        {
          scope: `store-create:ip:${sourceIp}`,
          windowMs: 60 * 60 * 1000,
          max: 10,
        },
      ],
      {
        message: 'Muitas lojas foram solicitadas. Tente novamente mais tarde.',
        code: 'STORE_RATE_LIMIT',
      },
      'specific-first',
      20,
      'control',
    );
    if (
      await db
        .prepare('SELECT 1 FROM stores WHERE code = ? LIMIT 1')
        .bind(code)
        .first()
    ) {
      throw new HttpError(
        409,
        'Este código de loja já está em uso.',
        'STORE_CODE_EXISTS',
      );
    }
    const storeId = crypto.randomUUID();
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO stores
             (id, name, code, next_sale_number, created_at, updated_at)
           SELECT ?, ?, ?, 1, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM users
             WHERE id = ? AND role = 'owner' AND active = 1
               AND store_id IS NULL
           )
           ON CONFLICT(code) DO NOTHING`,
        )
        .bind(storeId, name, code, now, now, session.id),
      db
        .prepare(
          `UPDATE users SET store_id = ?, updated_at = ?
           WHERE id = ? AND role = 'owner' AND active = 1
             AND store_id IS NULL
             AND EXISTS (
               SELECT 1 FROM stores WHERE id = ? AND code = ?
             )`,
        )
        .bind(storeId, now, session.id, storeId, code),
      db
        .prepare(
          `DELETE FROM stores
           WHERE id = ?
             AND NOT EXISTS (
               SELECT 1 FROM users WHERE id = ? AND store_id = ?
             )`,
        )
        .bind(storeId, session.id, storeId),
      db
        .prepare(
          `INSERT INTO audit_events
           (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
           SELECT ?, ?, ?, 'store.created', 'store', ?, NULL, ?
           WHERE EXISTS (
             SELECT 1 FROM users WHERE id = ? AND store_id = ?
           )`,
        )
        .bind(
          crypto.randomUUID(),
          storeId,
          session.id,
          storeId,
          now,
          session.id,
          storeId,
        ),
    ]);
    const created = Number(results[0]?.meta?.changes ?? 0) === 1;
    const claimed = Number(results[1]?.meta?.changes ?? 0) === 1;
    if (!created || !claimed) {
      const current = await db
        .prepare('SELECT store_id AS storeId FROM users WHERE id = ? LIMIT 1')
        .bind(session.id)
        .first<{ storeId: string | null }>();
      if (current?.storeId) {
        throw new HttpError(
          409,
          'Esta conta já possui uma loja.',
          'STORE_EXISTS',
        );
      }
      throw new HttpError(
        409,
        'Este código de loja já está em uso.',
        'STORE_CODE_EXISTS',
      );
    }
    return json(
      { ok: true, store: { id: storeId, name, code } },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
