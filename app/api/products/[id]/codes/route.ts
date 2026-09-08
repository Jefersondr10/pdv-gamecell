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
import { classifyCommercialCode, normalizeCommercialCode } from '@/lib/gtin';

export async function POST(
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
    const raw = stringField(body.code, 'Código', { min: 8, max: 18 });
    const code = normalizeCommercialCode(raw);
    if (!code) {
      throw new HttpError(400, 'UPC ou EAN inválido.', 'INVALID_CODE');
    }
    const kind = classifyCommercialCode(raw, code);
    const market = optionalMarket(body.market);
    const db = runtime().DB;
    const now = Date.now();
    await consumeStoreWriteBudget(db, now, session.storeId!, 3);
    const codeId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    let results;
    try {
      results = await db.batch([
        db
          .prepare(
            `INSERT INTO product_codes
             (id, store_id, product_id, code, kind, market, created_at)
             SELECT ?, p.store_id, p.id, ?, ?, ?, ?
             FROM products p
             WHERE p.id = ? AND p.store_id = ?
               AND (
                 SELECT COUNT(*) FROM product_codes pc
                 WHERE pc.product_id = p.id AND pc.store_id = p.store_id
               ) < 20`,
          )
          .bind(codeId, code, kind, market, now, id, session.storeId),
        db
          .prepare(
            `UPDATE products
             SET updated_at = MAX(COALESCE(updated_at, 0), ?)
             WHERE id = ? AND store_id = ?
               AND EXISTS (
                 SELECT 1 FROM product_codes
                 WHERE id = ? AND product_id = ? AND store_id = ?
               )`,
          )
          .bind(now, id, session.storeId, codeId, id, session.storeId),
        db
          .prepare(
            `INSERT INTO audit_events
             (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
             SELECT ?, ?, ?, 'product.code_added', 'product', ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM product_codes
               WHERE id = ? AND product_id = ? AND store_id = ?
             )`,
          )
          .bind(
            auditId,
            session.storeId,
            session.id,
            id,
            JSON.stringify({ codeId, code, kind, market }),
            now,
            codeId,
            id,
            session.storeId,
          ),
      ]);
    } catch (error) {
      if (isProductCodeConflict(error)) {
        throw new HttpError(
          409,
          'Este código já está vinculado a um produto.',
          'CODE_EXISTS',
        );
      }
      throw error;
    }
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
      const product = await db
        .prepare(
          `SELECT p.id, COUNT(pc.id) AS codeCount
           FROM products p
           LEFT JOIN product_codes pc
             ON pc.product_id = p.id AND pc.store_id = p.store_id
           WHERE p.id = ? AND p.store_id = ?
           GROUP BY p.id LIMIT 1`,
        )
        .bind(id, session.storeId)
        .first<{ id: string; codeCount: number }>();
      if (!product) {
        throw new HttpError(404, 'Produto não encontrado.', 'NOT_FOUND');
      }
      if (Number(product.codeCount) >= 20) {
        throw new HttpError(
          409,
          'Este produto atingiu o limite de 20 códigos.',
          'PRODUCT_CODE_LIMIT',
        );
      }
      throw new HttpError(
        409,
        'O produto foi alterado por outra operação. Atualize e tente novamente.',
        'PRODUCT_CODE_CONFLICT',
      );
    }
    return json(
      { ok: true, id: codeId, code: { id: codeId, code, kind, market } },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}

function optionalMarket(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  return stringField(value, 'Mercado', { max: 60 });
}

function isProductCodeConflict(error: unknown) {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed:.*product_codes\.(?:store_id|code)/i.test(
      error.message,
    )
  );
}
