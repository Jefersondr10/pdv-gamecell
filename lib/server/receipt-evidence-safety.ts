import { parseReceiptDocument } from '../receipt-document.ts';

// Use the same hard evidence checks before both automatic and explicit Pix
// registration. Choosing an account does not turn a scheduled/duplicate Pix into payment.
export const receiptConflictSql = `NOT EXISTS (
 SELECT 1 FROM attachments own JOIN (
 SELECT store_id,attachment_id,transaction_id FROM receipt_payment_links
 UNION ALL
 SELECT store_id,entity_id AS attachment_id,json_extract(details_json,'$.transactionId') AS transaction_id
 FROM audit_events WHERE action='sale.receipt_transaction_claimed' AND json_valid(details_json)
 ) claim ON claim.store_id=own.store_id
 AND claim.transaction_id=json_extract(CASE WHEN json_valid(own.receipt_details_json) THEN own.receipt_details_json ELSE '{}' END,'$.transactionId')
 WHERE own.store_id=? AND own.sale_id=? AND own.kind='receipt' AND claim.attachment_id<>own.id
) AND NOT EXISTS (
 SELECT 1 FROM attachments own JOIN attachments other ON other.store_id=own.store_id AND other.kind='receipt' AND other.id<>own.id
 AND json_extract(CASE WHEN json_valid(own.receipt_details_json) THEN own.receipt_details_json ELSE '{}' END,'$.transactionId')=
 json_extract(CASE WHEN json_valid(other.receipt_details_json) THEN other.receipt_details_json ELSE '{}' END,'$.transactionId')
 WHERE own.store_id=? AND own.sale_id=? AND own.kind='receipt'
)`;

// Explicit allocations can group several receipts into one payment, so keep
// their durable transaction claims in immutable audit history, not 1:1 links.
// The parent guard must have committed in the SAME batch before these SELECTs.
export function receiptClaimStatements(
  db: D1Database,
  scope: {
    storeId: string;
    saleId: string;
    actorId: string;
    paymentIds: string[];
  },
  receipts: { id: string; details?: string | null }[],
  guardId: string,
  guardDetails: string,
  now: number,
) {
  return receipts.flatMap((receipt) => {
    const identifiedId = parseReceiptDocument(receipt.details)?.transactionId;
    const transactionId =
      identifiedId && /^E[A-Za-z0-9]{31}$/.test(identifiedId)
        ? identifiedId
        : null;
    return [
      db
        .prepare(`INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
      SELECT ?,?,?,'sale.receipt_transaction_claimed','attachment',?,?,?
      WHERE EXISTS(SELECT 1 FROM audit_events WHERE id=? AND store_id=? AND entity_id=? AND details_json=?)
      AND NOT EXISTS(SELECT 1 FROM audit_events WHERE store_id=? AND entity_id=? AND action='sale.receipt_transaction_claimed' AND json_extract(details_json,'$.transactionId') IS ?)`)
        .bind(
          crypto.randomUUID(),
          scope.storeId,
          scope.actorId,
          receipt.id,
          JSON.stringify({
            transactionId,
            saleId: scope.saleId,
            paymentIds: scope.paymentIds,
          }),
          now,
          guardId,
          scope.storeId,
          scope.saleId,
          guardDetails,
          scope.storeId,
          receipt.id,
          transactionId,
        ),
    ];
  });
}

export async function receiptAllocationProblem(
  db: D1Database,
  storeId: string,
  saleId: string,
  receipts: { id: string }[],
  payments: { id: string; method: string }[],
) {
  const claims = await db
    .prepare(`SELECT entity_id AS attachmentId,details_json AS details FROM audit_events
    WHERE store_id=? AND action='sale.receipt_transaction_claimed' AND json_valid(details_json) AND json_extract(details_json,'$.saleId')=?`)
    .bind(storeId, saleId)
    .all<{ attachmentId: string; details: string }>();
  for (const claim of claims.results) {
    const details = JSON.parse(claim.details) as { paymentIds?: unknown };
    if (
      !receipts.some((r) => r.id === claim.attachmentId) ||
      !Array.isArray(details.paymentIds) ||
      !details.paymentIds.length ||
      details.paymentIds.some(
        (id) =>
          typeof id !== 'string' ||
          !payments.some((p) => p.id === id && p.method === 'pix'),
      )
    )
      return 'Um comprovante já aplicado ou seu pagamento foi alterado/excluído. Confira a alocação; o Pix não será registrado novamente.';
  }
  return null;
}

export async function receiptEvidenceProblem(
  db: D1Database,
  storeId: string,
  saleId: string,
  receipts: { details?: string | null }[],
) {
  const documents = receipts.map((r) => parseReceiptDocument(r.details));
  if (
    documents.some((doc) => doc && (doc.blocked || doc.state !== 'completed'))
  )
    return 'Documento sem confirmação de pagamento realizado: confira agendamento, processamento, cancelamento ou estorno.';
  if (documents.some((doc) => doc?.ambiguous))
    return 'A leitura do comprovante ficou ambígua. Reenvie uma imagem legível de uma única transação para conferência.';
  const ids = documents.map((d) => d?.transactionId).filter(Boolean);
  if (new Set(ids).size !== ids.length)
    return 'Há comprovantes da mesma transação. Não registre o Pix duas vezes.';
  const conflict = await db
    .prepare(
      `SELECT CASE WHEN ${receiptConflictSql} THEN 0 ELSE 1 END AS conflict`,
    )
    .bind(storeId, saleId, storeId, saleId)
    .first<{ conflict: number }>();
  return conflict?.conflict
    ? 'Esta transação aparece em outro comprovante. Ela não será somada novamente; confira os anexos.'
    : null;
}
