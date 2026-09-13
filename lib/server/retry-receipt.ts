import { HttpError } from './http.ts';
import { requestReceiptPaymentSync } from './receipt-payment-sync.ts';
import { can, type PermissionSubject } from '../permissions.ts';
import { refreshStoreReceivedTotals } from './sale-received-totals.ts';

export async function retryReceipt(
  db: D1Database,
  scope: {
    storeId: string;
    saleId: string;
    actorId: string;
    subject: PermissionSubject;
  },
  input: {
    attachmentId: string;
    operationId: string;
    expectedAmount: number | null;
    expectedConfirmedAt: number | null;
    expectedGeneration: number | null;
  },
  now: number,
) {
  if (!can(scope.subject, 'sales.receipts'))
    throw new HttpError(
      403,
      'Sem permissão para reler comprovantes.',
      'PERMISSION_DENIED',
    );
  const details = JSON.stringify(input);
  const old = await db
    .prepare(
      'SELECT store_id AS storeId,actor_user_id AS actorId,entity_id AS saleId,action,details_json AS details FROM audit_events WHERE id=?',
    )
    .bind(input.operationId)
    .first<{
      storeId: string;
      actorId: string;
      saleId: string;
      action: string;
      details: string;
    }>();
  if (old) {
    if (
      old.storeId !== scope.storeId ||
      old.actorId !== scope.actorId ||
      old.saleId !== scope.saleId ||
      old.action !== 'sale.receipt_reread' ||
      old.details !== details
    )
      throw new HttpError(
        409,
        'Esta operação já foi utilizada.',
        'OPERATION_ALREADY_USED',
      );
    await refreshStoreReceivedTotals(db, scope.storeId, {
      auditId: input.operationId,
      auditAction: 'sale.receipt_reread',
      auditEntityId: scope.saleId,
      auditDetails: details,
    }).run();
    return;
  }
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
      VALUES(?,?,?,'sale.receipt_reread','sale',CASE WHEN EXISTS(
        SELECT 1 FROM attachments a JOIN sales s ON s.id=a.sale_id AND s.store_id=a.store_id
        WHERE a.id=? AND a.sale_id=? AND a.store_id=? AND a.kind='receipt' AND s.status='completed'
        AND a.receipt_amount_cents IS ? AND a.receipt_amount_confirmed_at IS ?
        AND (SELECT j.generation FROM receipt_ocr_jobs j WHERE j.attachment_id=a.id) IS ?
        AND NOT EXISTS(SELECT 1 FROM receipt_ocr_jobs j WHERE j.attachment_id=a.id AND j.status IN ('pending','processing','retry'))
      ) THEN ? ELSE NULL END,?,?)`)
        .bind(
          input.operationId,
          scope.storeId,
          scope.actorId,
          input.attachmentId,
          scope.saleId,
          scope.storeId,
          input.expectedAmount,
          input.expectedConfirmedAt,
          input.expectedGeneration,
          scope.saleId,
          details,
          now,
        ),
      db
        .prepare(
          `UPDATE attachments SET receipt_amount_cents=NULL,receipt_amount_source=NULL,receipt_amount_confirmed_by=NULL,receipt_amount_confirmed_at=NULL,receipt_details_json=NULL,receipt_review_reason=NULL WHERE id=? AND store_id=? AND sale_id=? AND kind='receipt'`,
        )
        .bind(input.attachmentId, scope.storeId, scope.saleId),
      refreshStoreReceivedTotals(db, scope.storeId, {
        auditId: input.operationId,
        auditAction: 'sale.receipt_reread',
        auditEntityId: scope.saleId,
        auditDetails: details,
      }),
      db
        .prepare(`INSERT INTO receipt_ocr_jobs(attachment_id,status,attempts,generation,next_attempt_at,created_at,updated_at) VALUES(?,'pending',0,1,?,?,?)
        ON CONFLICT(attachment_id) DO UPDATE SET status='pending',generation=generation+1,attempts=0,next_attempt_at=excluded.next_attempt_at,lease_token=NULL,lease_until=NULL,error_code=NULL,confidence=NULL,updated_at=excluded.updated_at`)
        .bind(input.attachmentId, now, now, now),
      ...requestReceiptPaymentSync(db, scope, input.operationId, now),
    ]);
  } catch (error) {
    if (error instanceof Error && /constraint failed/i.test(error.message))
      throw new HttpError(
        409,
        'O comprovante mudou ou já está em leitura. Atualize antes de reler.',
        'OCR_NOT_RETRYABLE',
      );
    throw error;
  }
}
