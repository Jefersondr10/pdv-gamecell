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
import { consumeControlWriteBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let operationId = '';
  let operationFingerprint = '';
  let saleId = '';
  let storeId = '';
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const session = await requireSession(request, {
      roles: ['owner', 'admin'],
    });
    assertCsrf(request, session);
    ({ id: saleId } = await context.params);
    storeId = session.storeId!;
    const body = (await boundedJson(request)) as Record<string, unknown>;
    if (
      Object.keys(body).some((key) => key !== 'operationId' && key !== 'reason')
    ) {
      throw new HttpError(
        400,
        'O cancelamento contém um campo não reconhecido.',
        'UNKNOWN_FIELD',
      );
    }
    operationId = operationIdField(body.operationId);
    const reason = stringField(body.reason, 'Motivo', { min: 5, max: 500 });
    operationFingerprint = JSON.stringify({ saleId, reason });
    const db = runtime().DB;
    const replay = await findCancellationOperation(db, operationId);
    if (replay) {
      assertSameCancellation(replay, storeId, saleId, operationFingerprint);
      return json({ ok: true, replayed: true });
    }
    const sale = await db
      .prepare(
        `SELECT id, number, status, (
           SELECT COUNT(*) FROM sale_items
           WHERE sale_items.sale_id = sales.id
             AND sale_items.store_id = sales.store_id
         ) AS itemCount
         FROM sales WHERE id = ? AND store_id = ? LIMIT 1`,
      )
      .bind(saleId, storeId)
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
            `UPDATE receipt_ocr_jobs SET status='cancelled', generation=generation+1, lease_token=NULL, lease_until=NULL, updated_at=? WHERE status IN ('pending','processing','retry') AND attachment_id IN (SELECT id FROM attachments WHERE store_id=? AND sale_id=?)`,
          )
          .bind(now, storeId, saleId),
        db
          .prepare(
            `UPDATE sales SET status = 'cancelled', cancelled_at = ?,
             cancelled_by = ?, cancellation_reason = ?
             WHERE id = ? AND store_id = ? AND status = 'completed'`,
          )
          .bind(now, session.id, reason, saleId, storeId),
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
          .bind(storeId, saleId, saleId, storeId, now, session.id),
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
            operationId,
            storeId,
            session.id,
            saleId,
            storeId,
            now,
            session.id,
            storeId,
            saleId,
            saleId,
            JSON.stringify({
              number: sale.number,
              reason,
              operationFingerprint,
            }),
            now,
          ),
      ]);
    } catch (error) {
      const saved = await findCancellationOperation(db, operationId);
      if (saved) {
        assertSameCancellation(saved, storeId, saleId, operationFingerprint);
        return json({ ok: true, replayed: true });
      }
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
    return json({ ok: true, replayed: false });
  } catch (error) {
    return apiError(error);
  }
}

type CancellationOperation = {
  action: string;
  detailsJson: string | null;
  entityId: string;
  storeId: string;
};

async function findCancellationOperation(db: D1Database, operationId: string) {
  return db
    .prepare(
      `SELECT store_id AS storeId, action, entity_id AS entityId,
              details_json AS detailsJson
       FROM audit_events WHERE id = ? LIMIT 1`,
    )
    .bind(operationId)
    .first<CancellationOperation>();
}

function assertSameCancellation(
  operation: CancellationOperation,
  storeId: string,
  saleId: string,
  fingerprint: string,
) {
  let savedFingerprint = '';
  try {
    const details = JSON.parse(operation.detailsJson ?? '{}') as {
      operationFingerprint?: unknown;
    };
    if (typeof details.operationFingerprint === 'string') {
      savedFingerprint = details.operationFingerprint;
    }
  } catch {
    // A validação abaixo rejeita registros incompatíveis.
  }
  if (
    operation.storeId !== storeId ||
    operation.action !== 'sale.cancelled' ||
    operation.entityId !== saleId ||
    savedFingerprint !== fingerprint
  ) {
    throw new HttpError(
      409,
      'Esta operação já foi usada em outro cancelamento.',
      'OPERATION_ALREADY_USED',
    );
  }
}
