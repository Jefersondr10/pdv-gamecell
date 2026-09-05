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
      .prepare('SELECT 1 FROM clients WHERE id = ? AND store_id = ? LIMIT 1')
      .bind(id, session.storeId)
      .first();
    if (!exists) {
      throw new HttpError(404, 'Cliente não encontrado.', 'NOT_FOUND');
    }

    const updates: string[] = [];
    const bindings: unknown[] = [];
    const changed: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const value = stringField(body.name, 'Nome', { max: 120 });
      updates.push('name = ?');
      bindings.push(value);
      changed.name = value;
    }
    for (const [field, column, max] of [
      ['phone', 'phone', 40],
      ['email', 'email', 180],
      ['notes', 'notes', 500],
    ] as const) {
      if (body[field] === undefined) continue;
      const value = optionalString(body[field], max);
      const normalized =
        field === 'email' ? (value?.toLowerCase() ?? null) : value;
      updates.push(`${column} = ?`);
      bindings.push(normalized);
      changed[field] = normalized;
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
    updates.push('updated_at = ?');
    bindings.push(now, id, session.storeId);
    const results = await db.batch([
      db
        .prepare(
          `UPDATE clients SET ${updates.join(', ')}
           WHERE id = ? AND store_id = ?`,
        )
        .bind(...bindings),
      db
        .prepare(
          `INSERT INTO audit_events
           (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
           VALUES (?, ?, ?, 'client.updated', 'client', ?, ?, ?)`,
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
      throw new HttpError(404, 'Cliente não encontrado.', 'NOT_FOUND');
    }
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

function optionalString(value: unknown, max: number) {
  if (value === undefined || value === null || value === '') return null;
  return stringField(value, 'Campo', { max });
}
