import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  apiError,
  assertJsonRequest,
  assertSameOrigin,
  boundedJson,
  HttpError,
  json,
} from '@/lib/server/http';
import {
  normalizeOrderStatusName,
  orderStatusColor,
  orderStatusName,
} from '@/lib/server/order-status';
import {
  consumeStoreReadBudget,
  consumeStoreWriteBudget,
} from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import type { OrderStatusRecord } from '@/lib/pdv-types';

export const dynamic = 'force-dynamic';

const ORDER_STATUS_LIMIT = 30;

type OrderStatusRow = Omit<OrderStatusRecord, 'active'> & { active: number };

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const db = runtime().DB;
    await consumeStoreReadBudget(db, Date.now(), session.storeId!, 2);
    const result = await db
      .prepare(
        `SELECT id, name, color, active
         FROM order_statuses
         WHERE store_id = ?
         ORDER BY active DESC, name`,
      )
      .bind(session.storeId)
      .all<OrderStatusRow>();
    return json({
      items: (result.results ?? []).map((status) => ({
        ...status,
        active: Boolean(status.active),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const session = await requireSession(request, {
      roles: ['owner', 'admin'],
    });
    assertCsrf(request, session);
    const body = (await boundedJson(request)) as Record<string, unknown>;
    const name = orderStatusName(body.name);
    const nameNormalized = normalizeOrderStatusName(name);
    const color = orderStatusColor(body.color, 'slate');
    const id = crypto.randomUUID();
    const now = Date.now();
    const db = runtime().DB;
    await consumeStoreWriteBudget(db, now, session.storeId!, 3);

    if (
      await db
        .prepare(
          `SELECT 1 FROM order_statuses
           WHERE store_id = ? LIMIT 1 OFFSET ?`,
        )
        .bind(session.storeId, ORDER_STATUS_LIMIT - 1)
        .first()
    ) {
      throw statusLimitError();
    }

    try {
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO order_statuses
             (id, store_id, name, name_normalized, color, active,
              created_by, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, 1, ?, ?, ?
             WHERE (
               SELECT COUNT(*) FROM order_statuses WHERE store_id = ?
             ) < ?`,
          )
          .bind(
            id,
            session.storeId,
            name,
            nameNormalized,
            color,
            session.id,
            now,
            now,
            session.storeId,
            ORDER_STATUS_LIMIT,
          ),
        db
          .prepare(
            `INSERT INTO audit_events
             (id, store_id, actor_user_id, action, entity_type, entity_id,
              details_json, created_at)
             SELECT ?, ?, ?, 'order_status.created', 'order_status', ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM order_statuses WHERE id = ? AND store_id = ?
             )`,
          )
          .bind(
            crypto.randomUUID(),
            session.storeId,
            session.id,
            id,
            JSON.stringify({ name, color }),
            now,
            id,
            session.storeId,
          ),
      ]);
      if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
        throw statusLimitError();
      }
    } catch (error) {
      if (isDuplicateStatusName(error)) {
        throw new HttpError(
          409,
          'Já existe um status de pedido com este nome.',
          'ORDER_STATUS_EXISTS',
        );
      }
      throw error;
    }

    return json(
      { ok: true, item: { id, name, color, active: true } },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}

function statusLimitError() {
  return new HttpError(
    409,
    `Esta loja atingiu o limite de ${ORDER_STATUS_LIMIT} status de pedido.`,
    'ORDER_STATUS_LIMIT',
  );
}

function isDuplicateStatusName(error: unknown) {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed:.*order_statuses.*(?:store_id|name_normalized)/i.test(
      error.message,
    )
  );
}
