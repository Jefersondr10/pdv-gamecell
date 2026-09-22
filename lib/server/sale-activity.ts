import {
  SALE_ACTIVITY_TITLES,
  presentSaleActivity,
  type SaleActivityPage,
  type ReceiptConflicts,
  type ReceiptConflict,
} from '../sale-activity.ts';
import { HttpError } from './http.ts';

async function assertSale(db: D1Database, storeId: string, saleId: string) {
  const sale = await db
    .prepare('SELECT id FROM sales WHERE id=? AND store_id=?')
    .bind(saleId, storeId)
    .first();
  if (!sale)
    throw new HttpError(404, 'Venda não encontrada.', 'SALE_NOT_FOUND');
}

export async function readSaleActivity(
  db: D1Database,
  storeId: string,
  saleId: string,
  cursor: string | null = null,
): Promise<SaleActivityPage> {
  await assertSale(db, storeId, saleId);
  let timestamp = Number.MAX_SAFE_INTEGER;
  let id = '';
  if (cursor) {
    const separator = cursor.indexOf(':');
    timestamp = Number(cursor.slice(0, separator));
    id = cursor.slice(separator + 1);
    if (
      separator < 1 ||
      !Number.isSafeInteger(timestamp) ||
      timestamp < 0 ||
      !id ||
      id.length > 200
    )
      throw new HttpError(
        400,
        'Página de histórico inválida.',
        'INVALID_CURSOR',
      );
  }
  const actions = Object.keys(SALE_ACTIVITY_TITLES);
  const result = await db
    .prepare(`SELECT a.id,a.action,a.created_at AS createdAt,a.details_json AS details,u.display_name AS actor
    FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id AND u.store_id=a.store_id
    WHERE a.store_id=? AND a.entity_type='sale' AND a.entity_id=? AND a.action IN (${actions.map(() => '?').join(',')})
      AND (a.created_at<? OR (a.created_at=? AND a.id<?))
    ORDER BY a.created_at DESC,a.id DESC LIMIT 31`)
    .bind(storeId, saleId, ...actions, timestamp, timestamp, id)
    .all<{
      id: string;
      action: string;
      createdAt: number;
      details: string | null;
      actor: string | null;
    }>();
  const visible = result.results.slice(0, 30);
  const last = visible.at(-1);
  return {
    items: visible.map(presentSaleActivity),
    nextCursor:
      result.results.length > 30 && last
        ? `${last.createdAt}:${last.id}`
        : null,
  };
}

/** Same evidence sources as duplicateReceiptSql, scoped to this store and active sales. */
export async function readReceiptConflicts(
  db: D1Database,
  storeId: string,
  saleId: string,
): Promise<ReceiptConflicts> {
  await assertSale(db, storeId, saleId);
  const result = await db
    .prepare(`WITH docs AS (
      SELECT id,store_id,sale_id,CASE WHEN json_valid(receipt_details_json) THEN receipt_details_json ELSE '{}' END AS doc
      FROM attachments WHERE store_id=? AND kind='receipt'
    ), identities AS (
      SELECT id AS attachment_id,store_id,sale_id,json_extract(doc,'$.transactionId') AS identity FROM docs
      UNION ALL SELECT id,store_id,sale_id,json_extract(doc,'$.alternateTransactionId') FROM docs
    ), claims AS (
      SELECT * FROM identities
      UNION ALL SELECT attachment_id,store_id,sale_id,transaction_id FROM receipt_payment_links WHERE store_id=?
      UNION ALL SELECT entity_id,store_id,json_extract(details_json,'$.saleId'),json_extract(details_json,'$.transactionId')
        FROM audit_events WHERE store_id=? AND action='sale.receipt_transaction_claimed' AND json_valid(details_json)
    ) SELECT DISTINCT own.attachment_id AS receiptId,claim.attachment_id AS otherReceiptId,s.id AS saleId,s.number AS saleNumber,s.customer_name AS customerName
      FROM identities own JOIN claims claim ON claim.store_id=own.store_id AND claim.attachment_id<>own.attachment_id AND claim.identity=own.identity
      JOIN sales s ON s.id=claim.sale_id AND s.store_id=claim.store_id AND s.status='completed'
      WHERE own.sale_id=? AND own.store_id=? AND own.identity IS NOT NULL
      ORDER BY s.number DESC,receiptId,otherReceiptId LIMIT 51`)
    .bind(storeId, storeId, storeId, saleId, storeId)
    .all<ReceiptConflict>();
  return {
    items: result.results.slice(0, 50),
    hasMore: result.results.length > 50,
  };
}
