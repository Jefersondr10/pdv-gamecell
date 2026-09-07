import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  apiError,
  assertJsonRequest,
  assertSameOrigin,
  boundedJson,
  HttpError,
  integerField,
  json,
  stringField,
} from '@/lib/server/http';
import { consumeStoreWriteBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import { canonicalProductVariationKey } from '@/lib/server/system-catalog-sync';

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
    const db = runtime().DB;
    const now = Date.now();
    await consumeStoreWriteBudget(db, now, session.storeId!, 3);
    const exists = await db
      .prepare(
        `SELECT model, color, memory FROM products
         WHERE id = ? AND store_id = ? LIMIT 1`,
      )
      .bind(id, session.storeId)
      .first<{ model: string; color: string; memory: string }>();
    if (!exists) {
      throw new HttpError(404, 'Produto não encontrado.', 'NOT_FOUND');
    }

    const updates: string[] = [];
    const bindings: unknown[] = [];
    const changed: Record<string, unknown> = {};
    if (body.model !== undefined) {
      const value = stringField(body.model, 'Modelo', { max: 100 });
      updates.push('model = ?');
      bindings.push(value);
      changed.model = value;
    }
    if (body.color !== undefined) {
      const value = stringField(body.color, 'Cor', { max: 80 });
      updates.push('color = ?');
      bindings.push(value);
      changed.color = value;
    }
    if (body.memory !== undefined) {
      const value = stringField(body.memory, 'Memória', { max: 60 });
      updates.push('memory = ?');
      bindings.push(value);
      changed.memory = value;
    }
    if (body.defaultPriceCents !== undefined) {
      const value = integerField(body.defaultPriceCents, 'Preço', {
        min: 0,
        max: 1_000_000_000,
      });
      updates.push('default_price_cents = ?');
      bindings.push(value);
      changed.defaultPriceCents = value;
    }
    if (typeof body.active === 'boolean') {
      updates.push('active = ?');
      bindings.push(body.active ? 1 : 0);
      changed.active = body.active;
    }
    if (updates.length === 0) {
      throw new HttpError(
        400,
        'Nenhuma alteração foi informada.',
        'NO_CHANGES',
      );
    }
    if (
      changed.model !== undefined ||
      changed.color !== undefined ||
      changed.memory !== undefined
    ) {
      const nextVariationKey = canonicalProductVariationKey({
        model: (changed.model as string | undefined) ?? exists.model,
        color: (changed.color as string | undefined) ?? exists.color,
        memory: (changed.memory as string | undefined) ?? exists.memory,
      });
      const otherProducts = (
        await db
          .prepare(
            `SELECT model, color, memory FROM products
             WHERE store_id = ? AND id <> ? LIMIT 1000`,
          )
          .bind(session.storeId, id)
          .all<{ model: string; color: string; memory: string }>()
      ).results;
      if (
        otherProducts.some(
          (product) =>
            canonicalProductVariationKey(product) === nextVariationKey,
        )
      ) {
        throw new HttpError(
          409,
          'Já existe um produto com este modelo, cor e memória.',
          'PRODUCT_EXISTS',
        );
      }
    }
    updates.push('updated_at = ?');
    bindings.push(now, id, session.storeId);
    try {
      const results = await db.batch([
        db
          .prepare(
            `UPDATE products SET ${updates.join(', ')}
             WHERE id = ? AND store_id = ?`,
          )
          .bind(...bindings),
        db
          .prepare(
            `INSERT INTO audit_events
             (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
             VALUES (?, ?, ?, 'product.updated', 'product', ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            session.storeId,
            session.id,
            id,
            JSON.stringify(changed),
            now,
          ),
      ]);
      if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
        throw new HttpError(404, 'Produto não encontrado.', 'NOT_FOUND');
      }
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE constraint failed:.*products.*store_id/i.test(error.message)
      ) {
        throw new HttpError(
          409,
          'Já existe um produto com este modelo, cor e memória.',
          'PRODUCT_EXISTS',
        );
      }
      throw error;
    }
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
