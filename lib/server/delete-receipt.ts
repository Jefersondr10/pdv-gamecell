import { can, type PermissionSubject } from '../permissions.ts';
import { HttpError } from './http.ts';
import { cleanDeletedFile } from './file-deletion.ts';
import { cleanupResolvedReceiptReviews } from './receipt-auto-payment.ts';
import { refreshStoreReceivedTotals } from './sale-received-totals.ts';

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
  const safeClaimDetails = (alias: string) =>
    `CASE WHEN json_valid(${alias}.details_json) THEN ${alias}.details_json ELSE '{}' END`;
  const claimPaymentIds = (alias: string) => {
    const details = safeClaimDetails(alias);
    return `CASE WHEN json_type(${details}, '$.paymentIds') = 'array'
      THEN json_extract(${details}, '$.paymentIds') ELSE '[]' END`;
  };
  const stopDeletionSyncStatement = (now: number) =>
    db
      .prepare(`UPDATE sale_receipt_payment_sync
      SET status = 'manual', request_id = 'manual:' || lower(hex(randomblob(16))), updated_at = ?
      WHERE store_id = ? AND sale_id = ?
      AND EXISTS (SELECT 1 FROM audit_events WHERE id = ? AND store_id = ?
        AND action = 'sale.receipt_deleted' AND entity_id = ?)`)
      .bind(now, storeId, saleId, operationId, storeId, saleId);
  // This is also run for a replay. Older deployments could commit the audit
  // and attachment deletion while leaving a receipt-owned Pix (and therefore
  // the cached sale totals) behind. Only a direct link or a sale.payment_added
  // event with attachmentId proves ownership. Historical transaction claims
  // merely prove that evidence was allocated; they can point at manual or
  // aggregated Pix payments and are never deletion candidates by themselves.
  const committedPaymentRepairStatements = () => [
    db
      .prepare(`DELETE FROM receipt_payment_links
      WHERE attachment_id = ? AND sale_id = ? AND store_id = ?
      AND EXISTS (SELECT 1 FROM audit_events WHERE id = ? AND store_id = ?
        AND action = 'sale.receipt_deleted' AND entity_id = ?)`)
      .bind(receiptId, saleId, storeId, operationId, storeId, saleId),
    db
      .prepare(`DELETE FROM payments WHERE sale_id = ? AND store_id = ? AND method = 'pix'
      AND EXISTS (SELECT 1 FROM audit_events deletion
        WHERE deletion.id = ? AND deletion.store_id = ?
          AND deletion.action = 'sale.receipt_deleted' AND deletion.entity_id = ?)
      AND (
        id = (SELECT json_extract(${safeClaimDetails('deletion')}, '$.before.ownedPaymentId')
          FROM audit_events deletion WHERE deletion.id = ? AND deletion.store_id = ?)
        OR EXISTS (SELECT 1 FROM audit_events ownership
          WHERE ownership.id = payments.id AND ownership.store_id = payments.store_id
            AND ownership.entity_id = payments.sale_id AND ownership.action = 'sale.payment_added'
            AND json_extract(${safeClaimDetails('ownership')}, '$.paymentId') = payments.id
            AND json_extract(${safeClaimDetails('ownership')}, '$.attachmentId') = ?)
      )
      AND NOT EXISTS (SELECT 1 FROM receipt_payment_links active_link
        WHERE active_link.payment_id = payments.id AND active_link.store_id = payments.store_id
          AND active_link.sale_id = payments.sale_id)`)
      .bind(
        saleId,
        storeId,
        operationId,
        storeId,
        saleId,
        operationId,
        storeId,
        receiptId,
      ),
  ];
  const committedTotalRepairStatement = () =>
    refreshStoreReceivedTotals(db, storeId, {
      auditId: operationId,
      auditAction: 'sale.receipt_deleted',
      auditEntityId: saleId,
    });
  const repairCommittedDeletion = async () => {
    await db.batch([
      ...committedPaymentRepairStatements(),
      committedTotalRepairStatement(),
      cleanupResolvedReceiptReviews(db, storeId, saleId, operationId),
    ]);
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
    await repairCommittedDeletion();
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
      // Snapshot is taken inside the same transaction as the deletion: a
      // concurrent manual/OCR correction cannot produce stale audit evidence.
      db
        .prepare(`INSERT INTO audit_events
        (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
        SELECT ?, a.store_id, ?, 'sale.receipt_deleted', 'sale', a.sale_id,
          json_object('fingerprint', ?, 'receiptId', a.id, 'before', json_object(
            'name', a.file_name, 'mimeType', a.mime_type, 'sizeBytes', a.size_bytes,
            'amountCents', a.receipt_amount_cents, 'source', a.receipt_amount_source,
            'paymentId', (SELECT l.payment_id FROM receipt_payment_links l
              WHERE l.attachment_id = a.id AND l.store_id = a.store_id AND l.sale_id = a.sale_id),
            'ownedPaymentId', (SELECT l.payment_id FROM receipt_payment_links l
              WHERE l.attachment_id = a.id AND l.store_id = a.store_id AND l.sale_id = a.sale_id),
            'claimedPaymentIds', json((SELECT json_group_array(payment_id) FROM (
              SELECT DISTINCT CAST(claimed_payment.value AS TEXT) AS payment_id
              FROM audit_events receipt_claim
              JOIN json_each(${claimPaymentIds('receipt_claim')}) claimed_payment
              WHERE receipt_claim.store_id = a.store_id AND receipt_claim.entity_id = a.id
                AND receipt_claim.action = 'sale.receipt_transaction_claimed'
                AND json_extract(${safeClaimDetails('receipt_claim')}, '$.saleId') = a.sale_id
                AND typeof(claimed_payment.value) = 'text'
              ORDER BY payment_id))),
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
      // A concurrent deletion may remove the target after assertTarget. Stop
      // receipt processing only if this operation's guarded audit was created.
      // Replays intentionally do not execute this statement.
      stopDeletionSyncStatement(now),
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
      ...committedPaymentRepairStatements(),
      db
        .prepare(`DELETE FROM attachments WHERE id = ? AND sale_id = ? AND store_id = ? AND kind = 'receipt'
        AND EXISTS (SELECT 1 FROM audit_events WHERE id = ? AND store_id = ?)`)
        .bind(receiptId, saleId, storeId, operationId, storeId),
      committedTotalRepairStatement(),
      cleanupResolvedReceiptReviews(db, storeId, saleId, operationId),
    ]);
  } catch (error) {
    // Includes a duplicate retry and a lost response after transaction commit.
    const committed = await findOperation();
    if (!committed) throw error;
    validateOperation(committed);
    // D1 batch is atomic: observing this audit means the entire batch,
    // including payment and total repair, committed despite the lost reply.
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
