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
import { consumeStoreWriteBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const session = await requireSession(request, {
      roles: ['owner', 'admin'],
    });
    assertCsrf(request, session);
    const body = (await boundedJson(request)) as Record<string, unknown>;
    const name = stringField(body.name, 'Nome da conta', { max: 100 });
    const details =
      body.details === undefined || body.details === null || body.details === ''
        ? null
        : stringField(body.details, 'Detalhes', { max: 250 });
    const id = crypto.randomUUID();
    const now = Date.now();
    const db = runtime().DB;
    await consumeStoreWriteBudget(db, now, session.storeId!, 3);
    if (
      await db
        .prepare(
          'SELECT 1 FROM pix_accounts WHERE store_id = ? LIMIT 1 OFFSET 99',
        )
        .bind(session.storeId)
        .first()
    ) {
      throw new HttpError(
        409,
        'Esta loja atingiu o limite de 100 contas Pix.',
        'PIX_ACCOUNT_LIMIT',
      );
    }
    try {
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO pix_accounts
             (id, store_id, name, details, active, created_by, created_at, updated_at)
             SELECT ?, ?, ?, ?, 1, ?, ?, ?
             WHERE (
               SELECT COUNT(*) FROM pix_accounts WHERE store_id = ?
             ) < 100`,
          )
          .bind(
            id,
            session.storeId,
            name,
            details,
            session.id,
            now,
            now,
            session.storeId,
          ),
        db
          .prepare(
            `INSERT INTO audit_events
             (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
             SELECT ?, ?, ?, 'pix_account.created', 'pix_account', ?, NULL, ?
             WHERE EXISTS (
               SELECT 1 FROM pix_accounts WHERE id = ? AND store_id = ?
             )`,
          )
          .bind(
            crypto.randomUUID(),
            session.storeId,
            session.id,
            id,
            now,
            id,
            session.storeId,
          ),
      ]);
      if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
        throw new HttpError(
          409,
          'Esta loja atingiu o limite de 100 contas Pix.',
          'PIX_ACCOUNT_LIMIT',
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE constraint failed:.*pix_accounts.*store_id/i.test(error.message)
      ) {
        throw new HttpError(
          409,
          'Já existe uma conta com este nome.',
          'PIX_ACCOUNT_EXISTS',
        );
      }
      throw error;
    }
    return json({ ok: true, id }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
