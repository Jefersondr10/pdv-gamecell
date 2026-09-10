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
import { receiptAccountFields } from '@/lib/server/receipt-account-fields';

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
        'SELECT 1 FROM pix_accounts WHERE id = ? AND store_id = ? LIMIT 1',
      )
      .bind(id, session.storeId)
      .first();
    if (!exists) {
      throw new HttpError(404, 'Conta não encontrada.', 'NOT_FOUND');
    }

    const updates: string[] = [];
    const bindings: unknown[] = [];
    const changed: Record<string, unknown> = {};
    const receiptFields = receiptAccountFields(body);
    for (const [field, column] of [
      ['receiptBank', 'receipt_bank'],
      ['receiptRecipientDocument', 'receipt_recipient_document'],
    ] as const) {
      if (body[field] !== undefined) {
        updates.push(`${column} = ?`);
        bindings.push(receiptFields[field]);
        changed[field] = receiptFields[field];
      }
    }
    if (body.name !== undefined) {
      const value = stringField(body.name, 'Nome da conta', { max: 100 });
      updates.push('name = ?');
      bindings.push(value);
      changed.name = value;
    }
    if (body.details !== undefined) {
      const value = optionalString(body.details, 250);
      updates.push('details = ?');
      bindings.push(value);
      changed.details = value;
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
    try {
      const results = await db.batch([
        db
          .prepare(
            `UPDATE pix_accounts SET ${updates.join(', ')}
             WHERE id = ? AND store_id = ?`,
          )
          .bind(...bindings),
        db
          .prepare(
            `INSERT INTO audit_events
             (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
             VALUES (?, ?, ?, 'pix_account.updated', 'pix_account', ?, ?, ?)`,
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
        throw new HttpError(404, 'Conta não encontrada.', 'NOT_FOUND');
      }
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE constraint failed:.*pix_accounts.*store_id/i.test(error.message)
      ) {
        throw new HttpError(
          409,
          'Já existe uma conta com este nome.',
          'PIX_ACCOUNT_EXISTS',
        );
      }
      throw error;
    }
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

function optionalString(value: unknown, max: number) {
  if (value === undefined || value === null || value === '') return null;
  return stringField(value, 'Detalhes', { max });
}
