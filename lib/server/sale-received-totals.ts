import { SALE_RECEIVED_TOTAL_SQL } from './sale-status-sql.ts';

type RefreshGuard =
  | {
      auditId: string;
      auditAction: string;
      auditEntityId: string;
      auditDetails?: string;
    }
  | { receiptSyncRequestId: string; receiptSyncStatus: string };

type StoreRefreshGuard =
  | {
      auditId: string;
      auditAction: string;
      auditEntityId: string;
      auditDetails?: string;
    }
  | {
      receiptSyncSaleId: string;
      receiptSyncRequestId: string;
      receiptSyncStatus: string;
    };

/**
 * Keep the stored sale balance aligned with the single financial source of
 * truth: accepted receipts plus cash. Historical/manual Pix rows are retained
 * for audit purposes, but deliberately do not contribute to this cache.
 */
export function refreshSaleReceivedTotals(
  db: D1Database,
  storeId: string,
  saleId: string,
  guard: RefreshGuard,
) {
  const bindings: unknown[] = [saleId, storeId];
  let guardSql: string;
  if ('auditId' in guard) {
    guardSql = `AND EXISTS(SELECT 1 FROM audit_events refresh_guard
      WHERE refresh_guard.id=? AND refresh_guard.store_id=s.store_id
        AND refresh_guard.action=? AND refresh_guard.entity_id=?
        AND refresh_guard.entity_id=s.id${guard.auditDetails === undefined ? '' : ' AND refresh_guard.details_json=?'})`;
    bindings.push(guard.auditId, guard.auditAction, guard.auditEntityId);
    if (guard.auditDetails !== undefined) bindings.push(guard.auditDetails);
  } else {
    guardSql = `AND EXISTS(SELECT 1 FROM sale_receipt_payment_sync refresh_guard
      WHERE refresh_guard.sale_id=s.id AND refresh_guard.store_id=s.store_id
        AND refresh_guard.request_id=? AND refresh_guard.status=?)`;
    bindings.push(guard.receiptSyncRequestId, guard.receiptSyncStatus);
  }
  return db
    .prepare(`UPDATE sales AS s SET
      received_total_cents=${SALE_RECEIVED_TOTAL_SQL},
      received_difference_cents=${SALE_RECEIVED_TOTAL_SQL}-s.products_total_cents
      WHERE s.id=? AND s.store_id=? ${guardSql}`)
    .bind(...bindings);
}

/**
 * Receipt transaction identity is unique across a store. Adding, rereading or
 * removing one receipt can therefore change whether a receipt on another sale
 * is accepted. Normalize every divergent completed-sale cache atomically with
 * the guarded receipt mutation.
 */
export function refreshStoreReceivedTotals(
  db: D1Database,
  storeId: string,
  guard: StoreRefreshGuard,
) {
  const bindings: unknown[] = [storeId];
  let guardSql: string;
  if ('auditId' in guard) {
    guardSql = `EXISTS(SELECT 1 FROM audit_events refresh_guard
      WHERE refresh_guard.id=? AND refresh_guard.store_id=s.store_id
        AND refresh_guard.action=? AND refresh_guard.entity_id=?${guard.auditDetails === undefined ? '' : ' AND refresh_guard.details_json=?'})`;
    bindings.push(guard.auditId, guard.auditAction, guard.auditEntityId);
    if (guard.auditDetails !== undefined) bindings.push(guard.auditDetails);
  } else {
    guardSql = `EXISTS(SELECT 1 FROM sale_receipt_payment_sync refresh_guard
      WHERE refresh_guard.sale_id=? AND refresh_guard.store_id=s.store_id
        AND refresh_guard.request_id=? AND refresh_guard.status=?)`;
    bindings.push(
      guard.receiptSyncSaleId,
      guard.receiptSyncRequestId,
      guard.receiptSyncStatus,
    );
  }
  return db
    .prepare(`UPDATE sales AS s SET
      received_total_cents=${SALE_RECEIVED_TOTAL_SQL},
      received_difference_cents=${SALE_RECEIVED_TOTAL_SQL}-s.products_total_cents
      WHERE s.store_id=? AND s.status='completed'
      AND (s.received_total_cents<>${SALE_RECEIVED_TOTAL_SQL}
        OR s.received_difference_cents<>${SALE_RECEIVED_TOTAL_SQL}-s.products_total_cents)
      AND ${guardSql}`)
    .bind(...bindings);
}
