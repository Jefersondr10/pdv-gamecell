import {
  SYSTEM_SALE_STATUSES,
  type SystemSaleStatusKey,
} from '../sale-display-status.ts';

const receipts = `SELECT 1 FROM attachments ar WHERE ar.store_id = s.store_id AND ar.sale_id = s.id AND ar.kind = 'receipt'`;
const complete = `(EXISTS (${receipts}) AND NOT EXISTS (${receipts} AND ar.receipt_amount_cents IS NULL))`;
const failed = `EXISTS (${receipts} AND (ar.receipt_amount_cents <= 0 OR (ar.receipt_amount_cents IS NULL AND NOT EXISTS (SELECT 1 FROM receipt_ocr_jobs j WHERE j.attachment_id = ar.id AND j.status IN ('pending', 'processing', 'retry')))))`;
export const SALE_ISSUE_SQL: Record<
  Exclude<SystemSaleStatusKey, 'cancelled' | 'reconciled'>,
  string
> = {
  missing_price: `(s.products_total_cents <= 0 OR NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.store_id = s.store_id) OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.store_id = s.store_id AND si.sold_price_cents <= 0))`,
  missing_receipt: `NOT EXISTS (${receipts})`,
  review: `(${failed} OR (s.products_total_cents > 0 AND ${complete} AND COALESCE((SELECT SUM(ar.receipt_amount_cents) FROM attachments ar WHERE ar.store_id = s.store_id AND ar.sale_id = s.id AND ar.kind = 'receipt'), 0) <> s.products_total_cents))`,
  reading: `(NOT ${failed} AND EXISTS (${receipts} AND ar.receipt_amount_cents IS NULL))`,
  pending_payment: 's.received_total_cents < s.products_total_cents',
  overpaid: 's.received_total_cents > s.products_total_cents',
  missing_photo: `EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.store_id = s.store_id AND NOT EXISTS (SELECT 1 FROM attachments ap WHERE ap.sale_item_id = si.id AND ap.sale_id = s.id AND ap.store_id = s.store_id AND ap.kind = 'item_photo'))`,
};
export const SALE_AUTO_STATUS_SQL = `(CASE WHEN s.status = 'cancelled' THEN 'cancelled' ${SYSTEM_SALE_STATUSES.filter(
  (status) => status.key !== 'cancelled' && status.key !== 'reconciled',
)
  .map(
    (status) =>
      `WHEN ${SALE_ISSUE_SQL[status.key as keyof typeof SALE_ISSUE_SQL]} THEN '${status.key}'`,
  )
  .join(' ')} ELSE 'reconciled' END)`;
export const SALE_RECONCILED_SQL = `(${SALE_AUTO_STATUS_SQL} = 'reconciled')`;
export const SALE_ALERT_SQL = `(${SALE_AUTO_STATUS_SQL} NOT IN ('reconciled', 'cancelled'))`;
export function isSystemSaleStatus(key: string): key is SystemSaleStatusKey {
  return SYSTEM_SALE_STATUSES.some((status) => status.key === key);
}
