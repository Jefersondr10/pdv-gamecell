import { assertCsrf, requireSession } from '@/lib/server/auth';
import { apiError, assertSameOrigin, HttpError, json } from '@/lib/server/http';
import { consumeStoreWriteBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; codeId: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request, {
      roles: ['owner', 'admin'],
    });
    assertCsrf(request, session);
    const { id, codeId } = await context.params;
    const db = runtime().DB;
    const now = Date.now();
    await consumeStoreWriteBudget(db, now, session.storeId!, 3);
    const target = await db
      .prepare(
        `SELECT code FROM product_codes
         WHERE id = ? AND product_id = ? AND store_id = ? LIMIT 1`,
      )
      .bind(codeId, id, session.storeId)
      .first<{ code: string }>();
    if (!target) {
      throw new HttpError(404, 'Código não encontrado.', 'NOT_FOUND');
    }
    const auditId = crypto.randomUUID();
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO audit_events
           (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
           SELECT ?, ?, ?, 'product.code_removed', 'product', ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM product_codes
             WHERE id = ? AND product_id = ? AND store_id = ?
           )
             AND (
               SELECT COUNT(*) FROM product_codes
               WHERE product_id = ? AND store_id = ?
             ) > 1`,
        )
        .bind(
          auditId,
          session.storeId,
          session.id,
          id,
          JSON.stringify({ codeId, code: target.code }),
          now,
          codeId,
          id,
          session.storeId,
          id,
          session.storeId,
        ),
      db
        .prepare(
          `UPDATE products
           SET updated_at = MAX(COALESCE(updated_at, 0), ?)
           WHERE id = ? AND store_id = ?
             AND EXISTS (
               SELECT 1 FROM audit_events
               WHERE id = ? AND store_id = ?
             )`,
        )
        .bind(now, id, session.storeId, auditId, session.storeId),
      db
        .prepare(
          `DELETE FROM product_codes
           WHERE id = ? AND product_id = ? AND store_id = ?
             AND EXISTS (
               SELECT 1 FROM audit_events
               WHERE id = ? AND store_id = ?
             )`,
        )
        .bind(codeId, id, session.storeId, auditId, session.storeId),
    ]);
    if (Number(results[2]?.meta?.changes ?? 0) !== 1) {
      const current = await db
        .prepare(
          `SELECT COUNT(*) AS amount,
                  MAX(CASE WHEN id = ? THEN 1 ELSE 0 END) AS targetExists
           FROM product_codes
           WHERE product_id = ? AND store_id = ?`,
        )
        .bind(codeId, id, session.storeId)
        .first<{ amount: number; targetExists: number }>();
      if (Number(current?.targetExists ?? 0) !== 1) {
        throw new HttpError(404, 'Código não encontrado.', 'NOT_FOUND');
      }
      if (Number(current?.amount ?? 0) <= 1) {
        throw new HttpError(
          409,
          'O produto precisa manter pelo menos um UPC ou EAN.',
          'LAST_PRODUCT_CODE',
        );
      }
      throw new HttpError(
        409,
        'O produto foi alterado por outra operação. Atualize e tente novamente.',
        'PRODUCT_CODE_CONFLICT',
      );
    }
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
