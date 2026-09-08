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
import type { ProductPriceChange } from '@/lib/product-prices';

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const session = await requireSession(request, {
      roles: ['owner', 'admin'],
    });
    assertCsrf(request, session);
    const body = (await boundedJson(request, 192 * 1024)) as {
      prices?: unknown;
    };
    if (
      !Array.isArray(body.prices) ||
      !body.prices.length ||
      body.prices.length > 1000
    ) {
      throw new HttpError(
        400,
        'Selecione de 1 a 1.000 preços para alterar.',
        'INVALID_PRICES',
      );
    }
    const prices: ProductPriceChange[] = body.prices.map((input: unknown) => {
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new HttpError(400, 'Preço inválido.', 'INVALID_PRICES');
      const row = input as Record<string, unknown>;
      return {
        productId: stringField(row.productId, 'Produto', { max: 80 }),
        expectedPriceCents: integerField(
          row.expectedPriceCents,
          'Preço anterior',
          { min: 0, max: 1_000_000_000 },
        ),
        defaultPriceCents: integerField(row.defaultPriceCents, 'Preço', {
          min: 0,
          max: 1_000_000_000,
        }),
      };
    });
    if (new Set(prices.map((row) => row.productId)).size !== prices.length)
      throw new HttpError(
        400,
        'Produto repetido na alteração de preços.',
        'INVALID_PRICES',
      );
    const db = runtime().DB;
    const now = Date.now();
    await consumeStoreWriteBudget(db, now, session.storeId!, prices.length + 1);
    const payload = JSON.stringify(prices);
    // Validate membership first. The final guard is rechecked inside the write
    // transaction; one stale/foreign product prevents the entire price batch.
    const before = (
      await db
        .prepare(
          `SELECT p.id, p.default_price_cents AS price FROM products p
       JOIN json_each(?) j ON p.id = json_extract(j.value, '$.productId')
       WHERE p.store_id = ?`,
        )
        .bind(payload, session.storeId)
        .all<{ id: string; price: number }>()
    ).results;
    if (before.length !== prices.length)
      throw new HttpError(
        404,
        'Um dos produtos não foi encontrado nesta loja. Nenhum preço foi alterado.',
        'NOT_FOUND',
      );
    const results = await db.batch([
      db
        .prepare(
          `UPDATE products SET default_price_cents = (
           SELECT json_extract(j.value, '$.defaultPriceCents') FROM json_each(?) j
           WHERE json_extract(j.value, '$.productId') = products.id
         ), updated_at = ?
         WHERE store_id = ? AND id IN (SELECT json_extract(value, '$.productId') FROM json_each(?))
           AND NOT EXISTS (
             SELECT 1 FROM json_each(?) j LEFT JOIN products p
               ON p.id = json_extract(j.value, '$.productId') AND p.store_id = ?
             WHERE p.id IS NULL OR (p.default_price_cents <> json_extract(j.value, '$.expectedPriceCents')
               AND p.default_price_cents <> json_extract(j.value, '$.defaultPriceCents'))
           )`,
        )
        .bind(payload, now, session.storeId, payload, payload, session.storeId),
      db
        .prepare(
          `INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
         SELECT ?, ?, ?, 'product.prices_updated', 'store', ?, ?, ? WHERE changes() = ?`,
        )
        .bind(
          crypto.randomUUID(),
          session.storeId,
          session.id,
          session.storeId,
          JSON.stringify({ prices }),
          now,
          prices.length,
        ),
    ]);
    if (Number(results[0]?.meta?.changes ?? 0) !== prices.length)
      throw new HttpError(
        409,
        'Um preço mudou em outra tela. Nenhum preço deste envio foi alterado. Cancele a edição para carregar os valores atuais e tente novamente.',
        'PRICE_CONFLICT',
      );
    return json({ ok: true, prices });
  } catch (error) {
    return apiError(error);
  }
}
