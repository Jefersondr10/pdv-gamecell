import {
  SALE_CHECK_STATUSES,
  type SaleCheckKey,
  type SaleIssueKey,
} from '../sale-display-status.ts';

const receipts = `SELECT 1 FROM attachments ar WHERE ar.store_id = s.store_id AND ar.sale_id = s.id AND ar.kind = 'receipt'`;
export function validReceiptAmountSql(alias: 'a' | 'ar') {
  const column = `${alias}.receipt_amount_cents`;
  return `(typeof(${column}) = 'integer' AND ${column} > 0 AND ${column} <= 9007199254740991)`;
}
const complete = `(EXISTS (${receipts}) AND NOT EXISTS (${receipts} AND NOT ${validReceiptAmountSql('ar')}))`;
const failed = `EXISTS (${receipts} AND ((ar.receipt_amount_cents IS NOT NULL AND NOT ${validReceiptAmountSql('ar')}) OR (ar.receipt_amount_cents IS NULL AND NOT EXISTS (SELECT 1 FROM receipt_ocr_jobs j WHERE j.attachment_id = ar.id AND j.status IN ('pending', 'processing', 'retry')))))`;
export const SALE_PIX_TOTAL_SQL = `COALESCE((SELECT SUM(pix_payment.amount_cents) FROM payments pix_payment WHERE pix_payment.sale_id=s.id AND pix_payment.store_id=s.store_id AND pix_payment.method='pix'), 0)`;
export const SALE_ISSUE_SQL: Record<SaleIssueKey, string> = {
  missing_price: `(s.products_total_cents <= 0 OR NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.store_id = s.store_id) OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.store_id = s.store_id AND si.sold_price_cents <= 0))`,
  missing_receipt: `(${SALE_PIX_TOTAL_SQL} > 0 AND NOT EXISTS (${receipts}))`,
  review: `(EXISTS (${receipts} AND ar.receipt_review_reason IS NOT NULL) OR ${failed} OR (${complete} AND COALESCE((SELECT SUM(ar.receipt_amount_cents) FROM attachments ar WHERE ar.store_id = s.store_id AND ar.sale_id = s.id AND ar.kind = 'receipt'), 0) <> ${SALE_PIX_TOTAL_SQL}))`,
  reading: `(NOT ${failed} AND EXISTS (${receipts} AND ar.receipt_amount_cents IS NULL))`,
  pending_payment: 's.received_total_cents < s.products_total_cents',
  overpaid: 's.received_total_cents > s.products_total_cents',
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
