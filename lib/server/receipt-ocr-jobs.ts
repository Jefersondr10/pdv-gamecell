// Include in the same transaction as the new receipt, never after the response.
export function queueSaleReceipts(
  db: D1Database,
  storeId: string,
  saleId: string,
  now: number,
) {
  return db
    .prepare(`INSERT OR IGNORE INTO receipt_ocr_jobs (attachment_id, status, attempts, generation, next_attempt_at, created_at, updated_at)
    SELECT a.id, 'pending', 0, 1, ?, ?, ? FROM attachments a JOIN sales s ON s.id = a.sale_id AND s.store_id = a.store_id
    WHERE a.store_id = ? AND a.sale_id = ? AND a.kind = 'receipt' AND a.receipt_amount_cents IS NULL AND s.status = 'completed'`)
    .bind(now, now, now, storeId, saleId);
}
