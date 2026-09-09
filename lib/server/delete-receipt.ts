import { stopReceiptPaymentSync } from './receipt-payment-sync.ts';
import { can, type PermissionSubject } from '../permissions.ts';
import { HttpError } from './http.ts';
import { cleanDeletedFile } from './file-deletion.ts';

type DeleteInput = {
  operationId: string;
  saleId: string;
  receiptId: string;
  storeId: string;
  actorId: string;
  subject: PermissionSubject;
};
type Operation = {
  storeId: string;
  actorId: string;
  action: string;
  entityId: string;
  details: string;
};

export async function deleteSaleReceipt(
  db: D1Database,
  files: { delete: (key: string) => Promise<unknown> },
  input: DeleteInput,
) {
  if (!can(input.subject, 'sales.receipts.delete'))
    throw new HttpError(
      403,
      'Seu usuário não tem permissão para excluir comprovantes.',
      'PERMISSION_DENIED',
    );
  const { operationId, saleId, receiptId, storeId, actorId } = input;
  const fingerprint = JSON.stringify({ saleId, receiptId });
  const findOperation = () =>
    db
      .prepare(`SELECT store_id AS storeId, actor_user_id AS actorId,
    action, entity_id AS entityId, details_json AS details FROM audit_events WHERE id = ?`)
      .bind(operationId)
      .first<Operation>();
  const validateOperation = (operation: Operation) => {
    let recordedFingerprint: unknown;
    try {
      recordedFingerprint = JSON.parse(operation.details)?.fingerprint;
    } catch {
      recordedFingerprint = null;
    }
    if (
      operation.storeId !== storeId ||
      operation.actorId !== actorId ||
      operation.action !== 'sale.receipt_deleted' ||
      operation.entityId !== saleId ||
      recordedFingerprint !== fingerprint
    )
      throw new HttpError(
        409,
        'Este envio já foi usado em outra alteração.',
        'OPERATION_CONFLICT',
      );
  };
  const finish = async (replayed: boolean) => {
    // A cleanup outage must not report that the committed removal failed.
    let cleanupPending = true;
    try {
      cleanupPending = !(await cleanDeletedFile(db, files, operationId));
    } catch {
      /* The durable outbox remains available to the server worker. */
    }
    return { ok: true, receiptId, replayed, cleanupPending };
  };
  const previous = await findOperation();
  if (previous) {
    validateOperation(previous);
    return finish(true);
  }
  const assertTarget = async () => {
    const sale = await db
      .prepare('SELECT status FROM sales WHERE id = ? AND store_id = ?')
      .bind(saleId, storeId)
      .first<{ status: string }>();
    if (!sale)
      throw new HttpError(404, 'Venda não encontrada.', 'SALE_NOT_FOUND');
    if (sale.status !== 'completed')
      throw new HttpError(
        409,
        'Os comprovantes de uma venda cancelada são preservados.',
        'SALE_CANCELLED',
      );
    const receipt = await db
      .prepare(`SELECT id FROM attachments WHERE id = ?
      AND sale_id = ? AND store_id = ? AND kind = 'receipt'`)
      .bind(receiptId, saleId, storeId)
      .first();
    if (!receipt)
      throw new HttpError(
        404,
        'Comprovante não encontrado. Atualize a venda.',
        'RECEIPT_NOT_FOUND',
      );
  };
  await assertTarget();
  const now = Date.now();
  try {
    await db.batch([
      stopReceiptPaymentSync(db, storeId, saleId, now),
      // Snapshot is taken inside the same transaction as the deletion: a
      // concurrent manual/OCR correction cannot produce stale audit evidence.
      db
        .prepare(`INSERT INTO audit_events
        (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
        SELECT ?, a.store_id, ?, 'sale.receipt_deleted', 'sale', a.sale_id,
          json_object('fingerprint', ?, 'receiptId', a.id, 'before', json_object(
            'name', a.file_name, 'mimeType', a.mime_type, 'sizeBytes', a.size_bytes,
            'amountCents', a.receipt_amount_cents, 'source', a.receipt_amount_source,
            'confirmedBy', a.receipt_amount_confirmed_by, 'confirmedAt', a.receipt_amount_confirmed_at),
            'after', NULL), ?
        FROM attachments a JOIN sales s ON s.id = a.sale_id AND s.store_id = a.store_id
        WHERE a.id = ? AND a.sale_id = ? AND a.store_id = ? AND a.kind = 'receipt' AND s.status = 'completed'`)
        .bind(
          operationId,
          actorId,
          fingerprint,
          now,
          receiptId,
          saleId,
          storeId,
        ),
      db
        .prepare(`INSERT INTO file_deletion_jobs (operation_id, r2_key, attempts, next_attempt_at, created_at)
        SELECT ?, r2_key, 0, ?, ? FROM attachments WHERE id = ? AND sale_id = ? AND store_id = ? AND kind = 'receipt'
        AND EXISTS (SELECT 1 FROM audit_events WHERE id = ? AND store_id = ?)`)
        .bind(
          operationId,
          now,
          now,
          receiptId,
          saleId,
          storeId,
          operationId,
          storeId,
        ),
      db
        .prepare(`DELETE FROM receipt_ocr_jobs WHERE attachment_id = ?
        AND EXISTS (SELECT 1 FROM audit_events WHERE id = ? AND store_id = ?)
        AND EXISTS (SELECT 1 FROM attachments WHERE id = ? AND sale_id = ? AND store_id = ? AND kind = 'receipt')`)
        .bind(receiptId, operationId, storeId, receiptId, saleId, storeId),
      db
        .prepare(`DELETE FROM attachments WHERE id = ? AND sale_id = ? AND store_id = ? AND kind = 'receipt'
        AND EXISTS (SELECT 1 FROM audit_events WHERE id = ? AND store_id = ?)`)
        .bind(receiptId, saleId, storeId, operationId, storeId),
    ]);
  } catch (error) {
    // Includes a duplicate retry and a lost response after transaction commit.
    const committed = await findOperation();
    if (!committed) throw error;
    validateOperation(committed);
    return finish(true);
  }
  const committed = await findOperation();
  if (!committed) {
    await assertTarget();
    throw new HttpError(
      409,
      'A venda foi alterada. Atualize e tente novamente.',
      'SALE_CHANGED',
    );
  }
  validateOperation(committed);
  return finish(false);
}
