import {
  SALE_CHECK_STATUSES,
  type SaleCheckKey,
  type SaleIssueKey,
} from '../sale-display-status.ts';
import { DERIVED_RECEIPT_REVIEW_REASONS } from '../receipt-review-reasons.ts';

const receipts = `SELECT 1 FROM attachments ar WHERE ar.store_id = s.store_id AND ar.sale_id = s.id AND ar.kind = 'receipt'`;
export function validReceiptAmountSql(alias: 'a' | 'ar') {
  const column = `${alias}.receipt_amount_cents`;
  return `(typeof(${column}) = 'integer' AND ${column} > 0 AND ${column} <= 9007199254740991)`;
}
const complete = `(EXISTS (${receipts}) AND NOT EXISTS (${receipts} AND NOT ${validReceiptAmountSql('ar')}))`;
const failed = `EXISTS (${receipts} AND (${invalidReceiptDocumentSql('ar')} OR ${untrustedReceiptDocumentSql('ar')} OR (ar.receipt_amount_cents IS NOT NULL AND NOT ${validReceiptAmountSql('ar')}) OR (ar.receipt_amount_cents IS NULL AND NOT EXISTS (SELECT 1 FROM receipt_ocr_jobs j WHERE j.attachment_id = ar.id AND j.status IN ('pending', 'processing', 'retry')))))`;
export const SALE_PIX_TOTAL_SQL = `COALESCE((SELECT SUM(pix_payment.amount_cents) FROM payments pix_payment WHERE pix_payment.sale_id=s.id AND pix_payment.store_id=s.store_id AND pix_payment.method='pix'), 0)`;
export const SALE_CASH_TOTAL_SQL = `COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.sale_id=s.id AND p.store_id=s.store_id AND p.method='cash'),0)`;
export function duplicateReceiptSql(alias: string) {
  const transaction = (a: string) =>
    `json_extract(CASE WHEN json_valid(${a}.receipt_details_json) THEN ${a}.receipt_details_json ELSE '{}' END,'$.transactionId')`;
  return `(${transaction(alias)} IS NOT NULL AND (EXISTS(SELECT 1 FROM attachments other_receipt WHERE other_receipt.kind='receipt' AND other_receipt.store_id=${alias}.store_id AND other_receipt.id<>${alias}.id AND ${transaction('other_receipt')}=${transaction(alias)}) OR EXISTS(SELECT 1 FROM receipt_payment_links claimed WHERE claimed.store_id=${alias}.store_id AND claimed.attachment_id<>${alias}.id AND claimed.transaction_id=${transaction(alias)}) OR EXISTS(SELECT 1 FROM audit_events claimed_event WHERE claimed_event.store_id=${alias}.store_id AND claimed_event.action='sale.receipt_transaction_claimed' AND claimed_event.entity_id<>${alias}.id AND json_extract(CASE WHEN json_valid(claimed_event.details_json) THEN claimed_event.details_json ELSE '{}' END,'$.transactionId')=${transaction(alias)})))`;
}
// A present OCR document is accepted automatically only when the reader marked
// it eligible. Historical documents can keep their established value when an
// existing Pix payment is durably linked/claimed; null metadata remains the
// explicit legacy format.
export function linkedReceiptPaymentSql(alias: string) {
  const claim = `CASE WHEN json_valid(receipt_claim.details_json) THEN receipt_claim.details_json ELSE '{}' END`;
  return `(SELECT linked_payment.id FROM payments linked_payment WHERE linked_payment.store_id=${alias}.store_id AND linked_payment.sale_id=${alias}.sale_id AND linked_payment.method='pix' AND (
    EXISTS(SELECT 1 FROM receipt_payment_links receipt_link WHERE receipt_link.attachment_id=${alias}.id AND receipt_link.store_id=${alias}.store_id AND receipt_link.sale_id=${alias}.sale_id AND receipt_link.payment_id=linked_payment.id)
    OR EXISTS(SELECT 1 FROM audit_events receipt_claim JOIN json_each(json_extract(${claim},'$.paymentIds')) claimed_payment ON claimed_payment.value=linked_payment.id WHERE receipt_claim.store_id=${alias}.store_id AND receipt_claim.entity_id=${alias}.id AND receipt_claim.action='sale.receipt_transaction_claimed' AND json_extract(${claim},'$.saleId')=${alias}.sale_id)
  ) LIMIT 1)`;
}
// An absent document is supported for historical/manual receipts. A present but
// malformed document must not turn into that legacy exemption after parsing.
// Keep these checks aligned with parseReceiptDocument, including its === true
// interpretation of optional booleans.
export function invalidReceiptDocumentSql(alias: string) {
  const doc = `CASE WHEN json_valid(${alias}.receipt_details_json) THEN ${alias}.receipt_details_json ELSE '{}' END`;
  const metadataKeys = [
    'payerName',
    'payerBank',
    'recipientName',
    'recipientBank',
    'recipientDocument',
    'transactionId',
    'paidAtText',
  ]
    .map((field) => `'${field}'`)
    .join(',');
  // SQLite length(text) counts code points (and stops at NUL), but the parser's
  // String.length counts UTF-16 units. Count UTF-8 leading bytes only for the
  // uncommon >150-byte value; cap the walk as soon as it exceeds 150 units.
  const bytes = `CAST(receipt_metadata.value AS BLOB)`;
  const byte = `hex(substr(${bytes},byte_offset,1))`;
  const validLength = `(length(${bytes})<=150 OR (WITH RECURSIVE receipt_units(byte_offset,units) AS (
    SELECT 1,0 UNION ALL SELECT byte_offset+1,units+
      CASE WHEN ${byte}<'80' OR ${byte}>='C0' THEN 1 ELSE 0 END+
      CASE WHEN ${byte}>='F0' THEN 1 ELSE 0 END
    FROM receipt_units WHERE byte_offset<=length(${bytes}) AND units<=150
  ) SELECT MAX(units)<=150 FROM receipt_units))`;
  const validField = `(receipt_metadata.type='null' OR (receipt_metadata.type='text' AND ${validLength}))`;
  const metadata = `(SELECT COUNT(DISTINCT receipt_metadata.key) FROM json_each(${doc}) receipt_metadata WHERE receipt_metadata.key IN (${metadataKeys}) AND ${validField})=7`;
  return `(${alias}.receipt_details_json IS NOT NULL AND NOT COALESCE((json_type(${doc})='object' AND json_extract(${doc},'$.version')=1 AND json_type(${doc},'$.version') IN ('integer','real') AND json_extract(${doc},'$.state')='completed' AND COALESCE(json_type(${doc},'$.blocked'),'null')<>'true' AND COALESCE(json_type(${doc},'$.ambiguous'),'null')<>'true' AND ${metadata}),0))`;
}

export function untrustedReceiptDocumentSql(alias: string) {
  const doc = `CASE WHEN json_valid(${alias}.receipt_details_json) THEN ${alias}.receipt_details_json ELSE '{}' END`;
  return `(${alias}.receipt_details_json IS NOT NULL AND json_type(${doc},'$.automaticEligible') IS NOT 'true' AND ${linkedReceiptPaymentSql(alias)} IS NULL)`;
}

function receiptEvidenceAcceptedSql(alias: 'a' | 'ar') {
  return `(${validReceiptAmountSql(alias)} AND NOT ${duplicateReceiptSql(alias)} AND NOT ${invalidReceiptDocumentSql(alias)} AND NOT ${untrustedReceiptDocumentSql(alias)})`;
}

export function effectiveReceiptReviewReasonSql(alias: 'a' | 'ar') {
  const reasons = DERIVED_RECEIPT_REVIEW_REASONS
    .map((reason) => `'${reason.replaceAll("'", "''")}'`)
    .join(',');
  return `(CASE WHEN ${alias}.receipt_review_reason IN (${reasons}) AND ${receiptEvidenceAcceptedSql(alias)} THEN NULL ELSE NULLIF(${alias}.receipt_review_reason,'') END)`;
}

export function acceptedReceiptSql(alias: 'a' | 'ar') {
  return `(${receiptEvidenceAcceptedSql(alias)} AND ${effectiveReceiptReviewReasonSql(alias)} IS NULL)`;
}
export const SALE_RECEIPT_TOTAL_SQL = `COALESCE((SELECT SUM(ar.receipt_amount_cents) FROM attachments ar WHERE ar.store_id=s.store_id AND ar.sale_id=s.id AND ar.kind='receipt' AND ${acceptedReceiptSql('ar')}),0)`;
export const SALE_RECEIVED_TOTAL_SQL = `(${SALE_CASH_TOTAL_SQL} + ${SALE_RECEIPT_TOTAL_SQL})`;
export const SALE_RECEIPT_TARGET_SQL = `MAX(0,s.products_total_cents - ${SALE_CASH_TOTAL_SQL})`;
export const SALE_ISSUE_SQL: Record<SaleIssueKey, string> = {
  missing_price: `(s.products_total_cents <= 0 OR NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.store_id = s.store_id) OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.store_id = s.store_id AND si.sold_price_cents <= 0))`,
  missing_receipt: `(${SALE_RECEIPT_TARGET_SQL} > 0 AND NOT EXISTS (${receipts}))`,
  review: `(EXISTS (${receipts} AND (${duplicateReceiptSql('ar')} OR ${effectiveReceiptReviewReasonSql('ar')} IS NOT NULL OR (ar.receipt_amount_cents IS NOT NULL AND NOT ${acceptedReceiptSql('ar')}))) OR ${failed} OR (${complete} AND COALESCE((SELECT SUM(ar.receipt_amount_cents) FROM attachments ar WHERE ar.store_id = s.store_id AND ar.sale_id = s.id AND ar.kind = 'receipt'), 0) <> ${SALE_RECEIPT_TARGET_SQL}))`,
  reading: `(NOT ${failed} AND EXISTS (${receipts} AND ar.receipt_amount_cents IS NULL))`,
  pending_payment: `${SALE_RECEIVED_TOTAL_SQL} < s.products_total_cents`,
  overpaid: `${SALE_RECEIVED_TOTAL_SQL} > s.products_total_cents`,
  missing_photo: `EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.store_id = s.store_id AND NOT EXISTS (SELECT 1 FROM attachments ap WHERE ap.sale_item_id = si.id AND ap.sale_id = s.id AND ap.store_id = s.store_id AND ap.kind = 'item_photo'))`,
};
export const SALE_CHECK_STATUS_SQL = `(CASE WHEN s.status = 'cancelled' THEN 'cancelled' ${SALE_CHECK_STATUSES.filter(
  (status) => status.key !== 'cancelled' && status.key !== 'reconciled',
)
  .map(
    (status) =>
      `WHEN ${SALE_ISSUE_SQL[status.key as keyof typeof SALE_ISSUE_SQL]} THEN '${status.key}'`,
  )
  .join(' ')} ELSE 'reconciled' END)`;
export const SALE_RECONCILED_SQL = `(${SALE_CHECK_STATUS_SQL} = 'reconciled')`;
export const SALE_ALERT_SQL = `(${SALE_CHECK_STATUS_SQL} NOT IN ('reconciled', 'cancelled'))`;
export const SALE_AUTO_STATUS_SQL = `(CASE WHEN s.status = 'cancelled' THEN 'cancelled' WHEN ${SALE_RECONCILED_SQL} THEN 'reconciled' ELSE NULL END)`;
// Inactive registrations remain visible on historical sales. Reserved/foreign/orphaned links do not.
export const SALE_HAS_MANUAL_STATUS_SQL = `EXISTS (SELECT 1 FROM order_statuses display_status WHERE display_status.id = s.order_status_id AND display_status.store_id = s.store_id AND display_status.name_normalized NOT IN ('conciliado', 'cancelado'))`;
export const SALE_ISSUE_KEYS_SQL = `json_array(${Object.entries(SALE_ISSUE_SQL)
  .map(
    ([key, sql]) =>
      `CASE WHEN s.status <> 'cancelled' AND ${sql} THEN '${key}' END`,
  )
  .join(',')})`;
export function isSaleCheckStatus(key: string): key is SaleCheckKey {
  return SALE_CHECK_STATUSES.some((status) => status.key === key);
}

// Sale/payment/attachment/status edits append audit events in their transaction.
// Include the event count, not only MAX(time): different edits can share a clock
// tick. Jobs can progress without an audit event, so fingerprint their ordered
// rows and sync requests too. Aggregate count/MAX alone loses such transitions.
export const RECEIPT_ACTIVITY_SQL = `WITH
  scope AS (SELECT ? AS store_id),
  jobs AS (SELECT j.* FROM receipt_ocr_jobs j JOIN attachments a ON a.id=j.attachment_id WHERE a.store_id=(SELECT store_id FROM scope)),
  sync AS (SELECT * FROM sale_receipt_payment_sync WHERE store_id=(SELECT store_id FROM scope))
SELECT
  (SELECT COUNT(*) FROM jobs WHERE status IN ('pending','processing','retry')) +
  (SELECT COUNT(*) FROM sync WHERE status='pending') AS pending,
  (SELECT json_group_array(json_array(attachment_id,status,generation,reader_revision,attempts,error_code,confidence,next_attempt_at,lease_until,updated_at)) FROM (SELECT * FROM jobs ORDER BY attachment_id)) AS jobs,
  (SELECT json_group_array(json_array(sale_id,request_id,status,requested_by,target_payment_id,updated_at)) FROM (SELECT * FROM sync ORDER BY sale_id)) AS sync,
  (SELECT json_array(COUNT(*),MAX(created_at)) FROM audit_events WHERE store_id=(SELECT store_id FROM scope)) AS audit`;
