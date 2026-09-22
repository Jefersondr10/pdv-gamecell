import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  apiError,
  assertSameOrigin,
  boundedJson,
  HttpError,
  json,
  stringField,
} from '@/lib/server/http';
import { consumeStoreWriteBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import type { OrderStatusColor } from '@/lib/pdv-types';
import { orderStatusName } from '@/lib/server/order-status';

export const dynamic = 'force-dynamic';

type CurrentSale = {
  status: 'completed' | 'cancelled';
  orderStatusId: string | null;
  orderStatusName: string | null;
};

type StatusResult = {
  id: string | null;
  name: string | null;
  color: OrderStatusColor | null;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    assertCsrf(request, session);
    const { id: saleId } = await context.params;
    const body = await boundedJson(request);
    if (Object.keys(body).some((key) => key !== 'orderStatusId')) {
      throw new HttpError(
        400,
        'A alteração contém um campo não reconhecido.',
        'UNKNOWN_FIELD',
      );
    }
    const orderStatusId =
      body.orderStatusId === null
        ? null
        : stringField(body.orderStatusId, 'Status do pedido', { max: 80 });
    const db = runtime().DB;
    const now = Date.now();
    await consumeStoreWriteBudget(db, now, session.storeId!, 4);

    const current = await db
      .prepare(
        `SELECT s.status, s.order_status_id AS orderStatusId, o.name AS orderStatusName
         FROM sales s LEFT JOIN order_statuses o ON o.id=s.order_status_id AND o.store_id=s.store_id
         WHERE s.id = ? AND s.store_id = ? LIMIT 1`,
      )
      .bind(saleId, session.storeId)
      .first<CurrentSale>();
    if (!current) {
      throw new HttpError(404, 'Venda não encontrada.', 'SALE_NOT_FOUND');
    }
    if (current.status === 'cancelled') {
      throw new HttpError(
        409,
        'Uma venda cancelada não pode receber um novo status de pedido.',
        'SALE_CANCELLED',
      );
    }
    if (current.orderStatusId === orderStatusId) {
      return json({
        ok: true,
        orderStatus: await selectedStatus(db, session.storeId!, orderStatusId),
      });
    }

    let targetName: string | null = null;
    if (orderStatusId) {
      const target = await db
        .prepare(
          `SELECT name FROM order_statuses
           WHERE id = ? AND store_id = ? AND active = 1 LIMIT 1`,
        )
        .bind(orderStatusId, session.storeId)
        .first<{ name: string }>();
      if (!target) {
        throw new HttpError(
          409,
          'Selecione um status de pedido ativo.',
          'ORDER_STATUS_INVALID',
        );
      }
      orderStatusName(target.name);
      targetName = target.name;
    }

    const auditId = crypto.randomUUID();
    try {
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO audit_events
             (id, store_id, actor_user_id, action, entity_type, entity_id,
              details_json, created_at)
             SELECT ?, ?, ?, 'sale.order_status_changed', 'sale',
                    CASE WHEN EXISTS (
                      SELECT 1 FROM sales
                      WHERE id = ? AND store_id = ? AND status = 'completed'
                        AND order_status_id IS ?
                    ) AND (
                      ? IS NULL OR EXISTS (
                        SELECT 1 FROM order_statuses
                        WHERE id = ? AND store_id = ? AND active = 1 AND name = ?
                      )
                    ) THEN ? ELSE NULL END,
                    ?, ?`,
          )
          .bind(
            auditId,
            session.storeId,
            session.id,
            saleId,
            session.storeId,
            current.orderStatusId,
            orderStatusId,
            orderStatusId,
            session.storeId,
            targetName,
            saleId,
            JSON.stringify({
              previousOrderStatusId: current.orderStatusId,
              orderStatusId,
              previousOrderStatusName:
                current.orderStatusId === null
                  ? 'Sem status cadastrado'
                  : current.orderStatusName,
              orderStatusName:
                orderStatusId === null ? 'Sem status cadastrado' : targetName,
            }),
            now,
          ),
        db
          .prepare(
            `UPDATE sales SET order_status_id = ?
             WHERE id = ? AND store_id = ? AND status = 'completed'
               AND EXISTS (
                 SELECT 1 FROM audit_events
                 WHERE id = ? AND store_id = ?
               )`,
          )
          .bind(
            orderStatusId,
            saleId,
            session.storeId,
            auditId,
            session.storeId,
          ),
      ]);
      if (Number(results[1]?.meta?.changes ?? 0) !== 1) {
        throw new HttpError(
          409,
          'A venda foi alterada em outra operação. Atualize e tente novamente.',
          'SALE_CHANGED',
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        /NOT NULL constraint failed:\s*audit_events\.entity_id/i.test(
          error.message,
        )
      ) {
        throw new HttpError(
          409,
          'A venda ou o status foi alterado em outra operação. Atualize e tente novamente.',
          'SALE_CHANGED',
        );
      }
      throw error;
    }

    return json({
      ok: true,
      orderStatus: await selectedStatus(db, session.storeId!, orderStatusId),
    });
  } catch (error) {
    return apiError(error);
  }
}

async function selectedStatus(
  db: D1Database,
  storeId: string,
  orderStatusId: string | null,
) {
  if (!orderStatusId) return null;
  const status = await db
    .prepare(
      `SELECT id, name, color FROM order_statuses
       WHERE id = ? AND store_id = ? LIMIT 1`,
    )
    .bind(orderStatusId, storeId)
    .first<StatusResult>();
  return status?.id && status.name && status.color
    ? { id: status.id, name: status.name, color: status.color }
    : null;
}
