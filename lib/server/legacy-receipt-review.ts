import { can, type PermissionSubject } from '../permissions.ts';
import { HttpError } from './http.ts';
import { requestReceiptPaymentSync } from './receipt-payment-sync.ts';

const ACTION = 'sale.legacy_receipts_reread';
// Original, manually entered Pix rows are deliberately retained in history.
const LEGACY = `s.status='completed' AND EXISTS (
  SELECT 1 FROM payments p WHERE p.sale_id=s.id AND p.store_id=s.store_id AND p.method='pix'
  AND NOT EXISTS (SELECT 1 FROM receipt_payment_links l WHERE l.payment_id=p.id AND l.store_id=p.store_id AND l.sale_id=p.sale_id)
)`;
const REVIEWED = `EXISTS (SELECT 1 FROM audit_events e WHERE e.store_id=s.store_id AND e.entity_id=s.id AND e.action='${ACTION}')`;
const READING = `EXISTS (SELECT 1 FROM attachments a JOIN receipt_ocr_jobs j ON j.attachment_id=a.id
  WHERE a.store_id=s.store_id AND a.sale_id=s.id AND a.kind='receipt' AND j.status IN ('pending','processing','retry'))`;
const CANDIDATE = `${LEGACY} AND NOT ${REVIEWED} AND NOT ${READING}
  AND EXISTS (SELECT 1 FROM attachments a WHERE a.store_id=s.store_id AND a.sale_id=s.id AND a.kind='receipt' AND a.receipt_amount_source IS NOT 'manual')`;

type Scope = { storeId: string; actorId: string; subject: PermissionSubject };
function authorize(scope: Scope) {
  if (
    scope.subject.role === 'operator' ||
    !can(scope.subject, 'sales.receipts')
  )
    throw new HttpError(
      403,
      'Somente um administrador autorizado pode revisar vendas antigas.',
      'PERMISSION_DENIED',
    );
}

export async function legacyReceiptReviewStatus(db: D1Database, scope: Scope) {
  authorize(scope);
  const count = async (condition: string) =>
    (
      await db
        .prepare(
          `SELECT COUNT(*) AS total FROM sales s WHERE s.store_id=? AND ${condition}`,
        )
        .bind(scope.storeId)
        .first<{ total: number }>()
    )?.total ?? 0;
  return {
    eligibleSales: await count(CANDIDATE),
    reviewedSales: await count(REVIEWED),
    readingSales: await count(`${LEGACY} AND ${READING}`),
    missingReceiptSales: await count(
      `${LEGACY} AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.sale_id=s.id AND a.store_id=s.store_id AND a.kind='receipt')`,
    ),
    manualReceiptSales: await count(
      `${LEGACY} AND EXISTS (SELECT 1 FROM attachments a WHERE a.sale_id=s.id AND a.store_id=s.store_id AND a.kind='receipt' AND a.receipt_amount_source='manual')`,
    ),
  };
}

// Includes manual corrections and worker leases in the snapshot, so a concurrent
// edit/claim aborts the WHOLE sale instead of mixing old and new receipt values.
const SNAPSHOT = `(SELECT json_group_array(json_object(
  'id',id,'amount',receipt_amount_cents,'source',receipt_amount_source,
  'confirmedAt',receipt_amount_confirmed_at,'confirmedBy',receipt_amount_confirmed_by,
  'details',receipt_details_json,'review',receipt_review_reason,
  'generation',(SELECT generation FROM receipt_ocr_jobs WHERE attachment_id=a.id),
  'jobStatus',(SELECT status FROM receipt_ocr_jobs WHERE attachment_id=a.id)
)) FROM (SELECT * FROM attachments WHERE store_id=? AND sale_id=? AND kind='receipt' ORDER BY id) a)`;
type SnapshotRow = { id: string; source: string | null };

export async function queueLegacyReceiptReviews(
  db: D1Database,
  scope: Scope,
  now: number,
) {
  authorize(scope);
  const candidates = await db
    .prepare(
      `SELECT s.id FROM sales s WHERE s.store_id=? AND ${CANDIDATE} ORDER BY s.created_at,s.id LIMIT 5`,
    )
    .bind(scope.storeId)
    .all<{ id: string }>();
  let queuedSales = 0,
    queuedReceipts = 0,
    conflicts = 0;
  for (const sale of candidates.results) {
    const snapshot =
      (
        await db
          .prepare(`SELECT ${SNAPSHOT} AS snapshot`)
          .bind(scope.storeId, sale.id)
          .first<{ snapshot: string }>()
      )?.snapshot ?? '[]';
    const receipts = (JSON.parse(snapshot) as SnapshotRow[]).filter(
      (r) => r.source !== 'manual',
    );
    if (!receipts.length) continue;
    const operationId = crypto.randomUUID();
    try {
      await db.batch([
        db
          .prepare(`INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
          VALUES(?,?,?,'${ACTION}','sale',CASE WHEN EXISTS (
            SELECT 1 FROM sales s WHERE s.store_id=? AND s.id=? AND ${CANDIDATE}
          ) AND ${SNAPSHOT} IS ? THEN ? ELSE NULL END,?,?)`)
          .bind(
            operationId,
            scope.storeId,
            scope.actorId,
            scope.storeId,
            sale.id,
            scope.storeId,
            sale.id,
            snapshot,
            sale.id,
            JSON.stringify({
              version: 1,
              receipts: JSON.parse(snapshot),
              rereadIds: receipts.map((r) => r.id),
            }),
            now,
          ),
        ...receipts.flatMap((receipt) => [
          db
            .prepare(`UPDATE attachments SET receipt_amount_cents=NULL,receipt_amount_source=NULL,
            receipt_amount_confirmed_by=NULL,receipt_amount_confirmed_at=NULL,receipt_details_json=NULL,receipt_review_reason=NULL
            WHERE id=? AND store_id=? AND sale_id=? AND kind='receipt' AND receipt_amount_source IS NOT 'manual'`)
            .bind(receipt.id, scope.storeId, sale.id),
          db
            .prepare(`INSERT INTO receipt_ocr_jobs(attachment_id,status,attempts,generation,next_attempt_at,created_at,updated_at)
            VALUES(?,'pending',0,1,?,?,?) ON CONFLICT(attachment_id) DO UPDATE SET status='pending',generation=generation+1,
            attempts=0,next_attempt_at=excluded.next_attempt_at,lease_token=NULL,lease_until=NULL,error_code=NULL,confidence=NULL,updated_at=excluded.updated_at`)
            .bind(receipt.id, now, now, now),
        ]),
        ...requestReceiptPaymentSync(
          db,
          { ...scope, saleId: sale.id },
          operationId,
          now,
        ),
      ]);
      queuedSales++;
      queuedReceipts += receipts.length;
    } catch (error) {
      if (error instanceof Error && /constraint failed/i.test(error.message))
        conflicts++;
      else throw error;
    }
  }
  return { queuedSales, queuedReceipts, conflicts };
}
