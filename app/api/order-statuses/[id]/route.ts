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
    const db = runtime().DB;
    const now = Date.now();
    await consumeStoreWriteBudget(db, now, session.storeId!, 3);

    const exists = await db
      .prepare(
        'SELECT name FROM order_statuses WHERE id = ? AND store_id = ? LIMIT 1',
      )
      .bind(id, session.storeId)
      .first<{ name: string }>();
    if (!exists) {
      throw new HttpError(404, 'Status de pedido não encontrado.', 'NOT_FOUND');
    }

    const updates: string[] = [];
    if (body.active === true) orderStatusName(body.name ?? exists.name);
    const bindings: unknown[] = [];
    const changed: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = orderStatusName(body.name);
      updates.push('name = ?', 'name_normalized = ?');
      bindings.push(name, normalizeOrderStatusName(name));
      changed.name = name;
    }
    if (body.color !== undefined) {
      const color = orderStatusColor(body.color);
      updates.push('color = ?');
      bindings.push(color);
      changed.color = color;
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') {
        throw new HttpError(
          400,
          'A situação do status é inválida.',
          'INVALID_ORDER_STATUS_ACTIVE',
        );
      }
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

    updates.push('updated_at = ?');
    bindings.push(now, id, session.storeId);
    try {
      const results = await db.batch([
        db
          .prepare(`INSERT INTO audit_events
          (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
          SELECT ?, ?, ?, 'order_status.updated', 'order_status',
            CASE WHEN EXISTS (SELECT 1 FROM order_statuses WHERE id = ? AND store_id = ? AND name = ?) THEN ? ELSE NULL END, ?, ?`)
          .bind(
            crypto.randomUUID(),
            session.storeId,
            session.id,
            id,
            session.storeId,
            exists.name,
            id,
            JSON.stringify(changed),
            now,
          ),
        db
          .prepare(
            `UPDATE order_statuses SET ${updates.join(', ')}
             WHERE id = ? AND store_id = ?`,
          )
          .bind(...bindings),
      ]);
      if (Number(results[1]?.meta?.changes ?? 0) !== 1) {
        throw new HttpError(
          404,
          'Status de pedido não encontrado.',
          'NOT_FOUND',
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        /NOT NULL constraint failed:\s*audit_events\.entity_id/i.test(
          error.message,
        )
      )
        throw new HttpError(
          409,
          'Este cadastro mudou em outra tela. Atualize e tente novamente.',
          'ORDER_STATUS_CHANGED',
        );
      if (
        error instanceof Error &&
        /UNIQUE constraint failed:.*order_statuses.*(?:store_id|name_normalized)/i.test(
          error.message,
        )
      ) {
        throw new HttpError(
          409,
          'Já existe um status de pedido com este nome.',
          'ORDER_STATUS_EXISTS',
        );
      }
      throw error;
    }

    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
