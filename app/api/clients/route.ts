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

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const session = await requireSession(request);
    assertCsrf(request, session);
    const body = (await boundedJson(request)) as Record<string, unknown>;
    const name = stringField(body.name, 'Nome', { max: 120 });
    const phone = optionalString(body.phone, 40);
    const email = optionalString(body.email, 180)?.toLowerCase() ?? null;
    const notes = optionalString(body.notes, 500);
    const id = crypto.randomUUID();
    const now = Date.now();
    const db = runtime().DB;
    await consumeStoreWriteBudget(db, now, session.storeId!, 3);
    if (
      await db
        .prepare('SELECT 1 FROM clients WHERE store_id = ? LIMIT 1 OFFSET 4999')
        .bind(session.storeId)
        .first()
    ) {
      throw new HttpError(
        409,
        'Esta loja atingiu o limite de 5.000 clientes.',
        'CLIENT_LIMIT',
      );
    }
    await db.batch([
      db
        .prepare(
          `INSERT INTO clients
           (id, store_id, name, phone, email, notes, active, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .bind(
          id,
          session.storeId,
          name,
          phone,
          email,
          notes,
          session.id,
          now,
          now,
        ),
      db
        .prepare(
          `INSERT INTO audit_events
           (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
           VALUES (?, ?, ?, 'client.created', 'client', ?, NULL, ?)`,
        )
        .bind(crypto.randomUUID(), session.storeId, session.id, id, now),
    ]);
    return json({ ok: true, id }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

function optionalString(value: unknown, max: number) {
  if (value === undefined || value === null || value === '') return null;
  return stringField(value, 'Campo', { max });
}
