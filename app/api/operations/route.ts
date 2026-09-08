import { requireSession } from '@/lib/server/auth';
import { apiError, HttpError, json, operationIdField } from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import { consumeStoreReadBudget } from '@/lib/server/rate-limit';

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const params = new URL(request.url).searchParams;
    if (
      ['actor', 'id', 'kind'].some(
        (name) => params.getAll(name).length !== 1,
      ) ||
      [...params.keys()].some((name) => !['actor', 'id', 'kind'].includes(name))
    )
      throw new HttpError(400, 'Consulta inválida.', 'INVALID_QUERY');
    if (params.get('actor') !== session.id)
      throw new HttpError(
        403,
        'Entre na conta que iniciou esta operação.',
        'OPERATION_OWNER_CHANGED',
      );
    const id = operationIdField(params.get('id'));
    const kind = params.get('kind');
    if (kind !== 'sale' && kind !== 'entry')
      throw new HttpError(
        400,
        'Tipo de operação inválido.',
        'INVALID_OPERATION_KIND',
      );
    const db = runtime().DB;
    await consumeStoreReadBudget(db, Date.now(), session.storeId!, 2);
    const row =
      kind === 'sale'
        ? await db
            .prepare(
              `SELECT id, number, status FROM sales s
               WHERE id = ? AND store_id = ? AND EXISTS (
                 SELECT 1 FROM audit_events a
                 WHERE a.entity_id = s.id AND a.store_id = s.store_id
                   AND a.action = 'sale.created' AND a.actor_user_id = ?
               )`,
            )
            .bind(id, session.storeId, session.id)
            .first()
        : await db
            .prepare(
              'SELECT id, quantity AS added FROM entries WHERE id = ? AND store_id = ? AND operator_user_id = ?',
            )
            .bind(id, session.storeId, session.id)
            .first();
    return json({
      found: Boolean(row),
      result: row ? { ...row, receipts: [] } : undefined,
    });
  } catch (error) {
    return apiError(error);
  }
}
