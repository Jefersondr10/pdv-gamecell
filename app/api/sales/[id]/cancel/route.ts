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
import { consumeControlWriteBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';

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
    const reason = stringField(body.reason, 'Motivo', { min: 5, max: 500 });
    const db = runtime().DB;
    const sale = await db
      .prepare(
        `SELECT id, number, status, (
           SELECT COUNT(*) FROM sale_items
           WHERE sale_items.sale_id = sales.id
             AND sale_items.store_id = sales.store_id
         ) AS itemCount
         FROM sales WHERE id = ? AND store_id = ? LIMIT 1`,
      )
      .bind(id, session.storeId)
      .first<{
        id: string;
        number: number;
        status: string;
        itemCount: number;
      }>();
    if (!sale) throw new HttpError(404, 'Venda não encontrada.', 'NOT_FOUND');
    if (sale.status === 'cancelled') {
      throw new HttpError(
        409,
        'Esta venda já foi cancelada.',
        'ALREADY_CANCELLED',
      );
    }
    const now = Date.now();
    await consumeControlWriteBudget(
      db,
      now,
      session.storeId!,
      session.id,
      8 + Math.min(50, Number(sale.itemCount) || 0) * 2,
    );
    try {
      await db.batch([
        db
          .prepare(
            `UPDATE sales SET status = 'cancelled', cancelled_at = ?,
             cancelled_by = ?, cancellation_reason = ?
             WHERE id = ? AND store_id = ? AND status = 'completed'`,
          )
          .bind(now, session.id, reason, id, session.storeId),
        db
          .prepare(
            `UPDATE inventory_units SET status = 'available', sale_id = NULL, sold_at = NULL
             WHERE store_id = ? AND sale_id = ? AND status = 'sold'
               AND EXISTS (
                 SELECT 1 FROM sales
                 WHERE id = ? AND store_id = ? AND status = 'cancelled'
                   AND cancelled_at = ? AND cancelled_by = ?
               )`,
          )
          .bind(session.storeId, id, id, session.storeId, now, session.id),
        db
          .prepare(
            `INSERT INTO audit_events
             (id, store_id, actor_user_id, action, entity_type, entity_id,
              details_json, created_at)
             VALUES (?, ?, ?, 'sale.cancelled', 'sale',
               CASE WHEN EXISTS (
                 SELECT 1 FROM sales
                 WHERE id = ? AND store_id = ? AND status = 'cancelled'
                   AND cancelled_at = ? AND cancelled_by = ?
               ) AND NOT EXISTS (
                 SELECT 1 FROM audit_events
                 WHERE store_id = ? AND action = 'sale.cancelled'
                   AND entity_type = 'sale' AND entity_id = ?
               ) THEN ? ELSE NULL END,
               ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            session.storeId,
            session.id,
            id,
            session.storeId,
            now,
            session.id,
            session.storeId,
            id,
            id,
            JSON.stringify({ number: sale.number, reason }),
            now,
          ),
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        /NOT NULL constraint failed:\s*audit_events\.entity_id/i.test(
          error.message,
        )
      ) {
        throw new HttpError(
          409,
          'Esta venda já foi cancelada.',
          'ALREADY_CANCELLED',
        );
      }
      throw error;
    }
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
