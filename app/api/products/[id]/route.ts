import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  apiError,
  assertJsonRequest,
  assertSameOrigin,
  boundedJson,
  HttpError,
  integerField,
  json,
} from '@/lib/server/http';
import { consumeStoreWriteBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const session = await requireSession(request, {
      roles: ['owner', 'admin'],
    });
    assertCsrf(request, session);
    const { id } = await context.params;
    const body = (await boundedJson(request)) as Record<string, unknown>;
    const price = integerField(body.defaultPriceCents, 'Preço', {
      min: 0,
      max: 1_000_000_000,
    });
    const db = runtime().DB;
    const now = Date.now();
    await consumeStoreWriteBudget(db, now, session.storeId!, 3);
    const results = await db.batch([
      db
        .prepare(
          `UPDATE products SET default_price_cents = ?, updated_at = ?
           WHERE id = ? AND store_id = ?`,
        )
        .bind(price, now, id, session.storeId),
      db
        .prepare(
          `INSERT INTO audit_events
           (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
           SELECT ?, ?, ?, 'product.price_changed', 'product', ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM products
             WHERE id = ? AND store_id = ? AND updated_at = ?
               AND default_price_cents = ?
           )`,
        )
        .bind(
          crypto.randomUUID(),
          session.storeId,
          session.id,
          id,
          JSON.stringify({ defaultPriceCents: price }),
          now,
          id,
          session.storeId,
          now,
          price,
        ),
    ]);
    if (
      Number(results[0]?.meta?.changes ?? 0) !== 1 ||
      Number(results[1]?.meta?.changes ?? 0) !== 1
    ) {
      throw new HttpError(404, 'Produto não encontrado.', 'NOT_FOUND');
    }
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
