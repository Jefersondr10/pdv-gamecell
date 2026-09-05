import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  apiError,
  assertJsonRequest,
  assertSameOrigin,
  boundedJson,
  HttpError,
  json,
  operationIdField,
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
    const id = operationIdField(body.operationId);
    const now = Date.now();
    const db = runtime().DB;
    const existing = await findClientById(db, id);
    if (existing) {
      assertSameClientOperation(
        existing,
        session.storeId!,
        name,
        phone,
        email,
        notes,
      );
      return json({ ok: true, id, replayed: true });
    }
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
    const results = await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO clients
           (id, store_id, name, phone, email, notes, active, created_by, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, 1, ?, ?, ?
           WHERE (
             SELECT COUNT(*) FROM clients WHERE store_id = ?
           ) < 5000`,
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
          session.storeId,
        ),
      db
        .prepare(
          `INSERT INTO audit_events
           (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
           SELECT ?, ?, ?, 'client.created', 'client', ?, NULL, ?
           WHERE EXISTS (
             SELECT 1 FROM clients WHERE id = ? AND store_id = ?
           ) AND NOT EXISTS (
             SELECT 1 FROM audit_events
             WHERE store_id = ? AND action = 'client.created'
               AND entity_type = 'client' AND entity_id = ?
           )`,
        )
        .bind(
          crypto.randomUUID(),
          session.storeId,
          session.id,
          id,
          now,
          id,
          session.storeId,
          session.storeId,
          id,
        ),
    ]);
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
      const replay = await findClientById(db, id);
      if (replay) {
        assertSameClientOperation(
          replay,
          session.storeId!,
          name,
          phone,
          email,
          notes,
        );
        return json({ ok: true, id, replayed: true });
      }
      throw new HttpError(
        409,
        'Esta loja atingiu o limite de 5.000 clientes.',
        'CLIENT_LIMIT',
      );
    }
    return json({ ok: true, id }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

type ClientOperationRow = {
  storeId: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

async function findClientById(db: D1Database, id: string) {
  return db
    .prepare(
      `SELECT store_id AS storeId, name, phone, email, notes
       FROM clients WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<ClientOperationRow>();
}

function assertSameClientOperation(
  existing: ClientOperationRow,
  storeId: string,
  name: string,
  phone: string | null,
  email: string | null,
  notes: string | null,
) {
  if (
    existing.storeId !== storeId ||
    existing.name !== name ||
    existing.phone !== phone ||
    existing.email !== email ||
    existing.notes !== notes
  ) {
    throw new HttpError(
      409,
      'Este identificador já foi usado em outro cadastro. Tente salvar novamente.',
      'OPERATION_REUSED',
    );
  }
}

function optionalString(value: unknown, max: number) {
  if (value === undefined || value === null || value === '') return null;
  return stringField(value, 'Campo', { max });
}
