// Reconstruct only the original operation, never reapply these historical values.
export async function originalSalePayments(
  db: D1Database,
  storeId: string,
  saleId: string,
) {
  return db
    .prepare(`SELECT COALESCE(json_extract(original_json,'$.method'),method) AS method,
    CASE WHEN original_json IS NULL THEN pix_account_id ELSE json_extract(original_json,'$.pixAccountId') END AS pixAccountId,
    COALESCE(json_extract(original_json,'$.amountCents'),amount_cents) AS amountCents
    FROM (SELECT p.*, (SELECT j.value FROM audit_events a, json_each(a.details_json,'$.before') j
      WHERE a.store_id=p.store_id AND a.entity_id=p.sale_id
        AND a.action IN ('sale.payments_corrected','sale.payment_from_receipts')
        AND json_extract(j.value,'$.id')=p.id ORDER BY a.created_at,a.rowid LIMIT 1) AS original_json
      FROM payments p WHERE p.sale_id=? AND p.store_id=? AND NOT EXISTS (
        SELECT 1 FROM audit_events a WHERE a.id=p.id AND a.store_id=p.store_id AND a.entity_id=p.sale_id AND a.action='sale.payment_added'))
    ORDER BY created_at,id`)
    .bind(saleId, storeId)
    .all<{
      method: 'pix' | 'cash';
      pixAccountId: string | null;
      amountCents: number;
    }>();
}
