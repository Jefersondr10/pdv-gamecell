import {
  can,
  resolvePermissions,
  type PermissionSubject,
} from '../permissions.ts';

type Payment = {
  id: string;
  method: string;
  pixAccountId: string | null;
  accountName: string | null;
  amountCents: number;
};
type Receipt = {
  id: string;
  amountCents: number | null;
  source: string | null;
  confirmedAt: number | null;
};
type RequestRow = {
  requestId: string;
  requestedBy: string;
  targetPaymentId: string | null;
  status: string;
  updatedAt: number;
};

// Called IN the transaction that saves a new receipt or an explicit correction.
// Browser OCR completion must never create a new intent after a manual payment.
export function requestReceiptPaymentSync(
  db: D1Database,
  scope: {
    storeId: string;
    saleId: string;
    actorId: string;
    subject: PermissionSubject;
  },
  requestId: string,
  now: number,
  targetPaymentId: string | null = null,
) {
  if (!can(scope.subject, 'sales.payments'))
    return [stopReceiptPaymentSync(db, scope.storeId, scope.saleId, now)];
  return [
    db
      .prepare(`INSERT INTO sale_receipt_payment_sync
    (sale_id, store_id, request_id, requested_by, target_payment_id, status, updated_at)
    SELECT id, store_id, ?, ?, ?, 'pending', ? FROM sales WHERE id=? AND store_id=? AND status='completed'
    ON CONFLICT(sale_id) DO UPDATE SET request_id=excluded.request_id, requested_by=excluded.requested_by,
      target_payment_id=excluded.target_payment_id, status='pending', updated_at=excluded.updated_at`)
      .bind(
        requestId,
        scope.actorId,
        targetPaymentId,
        now,
        scope.saleId,
        scope.storeId,
      ),
  ];
}

export function stopReceiptPaymentSync(
  db: D1Database,
  storeId: string,
  saleId: string,
  now: number,
) {
  return db
    .prepare(
      `UPDATE sale_receipt_payment_sync SET status='manual', request_id='manual:'||lower(hex(randomblob(16))), updated_at=? WHERE store_id=? AND sale_id=?`,
    )
    .bind(now, storeId, saleId);
}

const paymentSnapshot = `(SELECT json_group_array(json_object('id',id,'method',method,'pixAccountId',pix_account_id,'accountName',account_name,'amountCents',amount_cents)) FROM (SELECT * FROM payments WHERE sale_id=? AND store_id=? ORDER BY id))`;
const receiptSnapshot = `(SELECT json_group_array(json_object('id',id,'amountCents',receipt_amount_cents,'source',receipt_amount_source,'confirmedAt',receipt_amount_confirmed_at)) FROM (SELECT * FROM attachments WHERE sale_id=? AND store_id=? AND kind='receipt' ORDER BY id))`;

export async function readReceiptPaymentSync(
  db: D1Database,
  storeId: string,
  saleId: string,
) {
  const results = await db.batch([
    db
      .prepare(`SELECT status, products_total_cents AS productsTotalCents, received_total_cents AS receivedTotalCents,
      received_difference_cents AS receivedDifferenceCents, ${paymentSnapshot} AS paymentsJson, ${receiptSnapshot} AS receiptsJson
      FROM sales WHERE id=? AND store_id=?`)
      .bind(saleId, storeId, saleId, storeId, saleId, storeId),
    db
      .prepare(`SELECT request_id AS requestId, requested_by AS requestedBy, target_payment_id AS targetPaymentId, status, updated_at AS updatedAt
      FROM sale_receipt_payment_sync WHERE sale_id=? AND store_id=?`)
      .bind(saleId, storeId),
  ]);
  const sale = results[0].results[0] as
    | {
        status: string;
        productsTotalCents: number;
        receivedTotalCents: number;
        receivedDifferenceCents: number;
        paymentsJson: string;
        receiptsJson: string;
      }
    | undefined;
  if (!sale) return null;
  const payments: Payment[] = JSON.parse(sale.paymentsJson);
  const receipts: Receipt[] = JSON.parse(sale.receiptsJson);
  const complete =
    receipts.length > 0 &&
    receipts.every(
      (r) => Number.isSafeInteger(r.amountCents) && r.amountCents! > 0,
    );
  const total = receipts.reduce((sum, r) => sum + (r.amountCents ?? 0), 0);
  return {
    sale,
    payments,
    receipts,
    complete,
    total,
    request: results[1].results[0] as RequestRow | undefined,
  };
}

// Durable, race-safe settlement. All payment rows remain consistent with sale totals.
// Multiple payments require an explicit target; no invented bank allocation.
export async function settleReceiptPaymentSync(
  db: D1Database,
  storeId: string,
  saleId: string,
) {
  const current = await readReceiptPaymentSync(db, storeId, saleId);
  const request = current?.request;
  if (!current || !request || request.status !== 'pending') return;
  const { sale, payments, receipts, complete, total } = current;
  if (sale.status !== 'completed' || !complete) return;
  const actor = await db
    .prepare(
      `SELECT role, permissions_json AS permissionsJson, active FROM users WHERE id=? AND store_id=?`,
    )
    .bind(request.requestedBy, storeId)
    .first<{
      role: PermissionSubject['role'];
      permissionsJson: string | null;
      active: number;
    }>();
  const allowed =
    actor?.active === 1 &&
    can(
      {
        role: actor.role,
        permissions: resolvePermissions(actor.role, actor.permissionsJson),
      },
      'sales.payments',
    );
  const target = request.targetPaymentId
    ? payments.find((p) => p.id === request.targetPaymentId)
    : payments.length === 1
      ? payments[0]
      : undefined;
  const targetAmount = target
    ? total -
      payments
        .filter((p) => p.id !== target.id)
        .reduce((sum, p) => sum + p.amountCents, 0)
    : 0;
  const matched = total === sale.receivedTotalCents;
  if (
    !allowed ||
    (!matched &&
      (!target || targetAmount < 1 || targetAmount > 1_000_000_000)) ||
    !Number.isSafeInteger(total) ||
    total > 100_000_000_000
  ) {
    await db
      .prepare(
        `UPDATE sale_receipt_payment_sync SET status='review', updated_at=? WHERE sale_id=? AND store_id=? AND request_id=? AND status='pending'`,
      )
      .bind(Date.now(), saleId, storeId, request.requestId)
      .run();
    return;
  }
  const after = payments.map((p) =>
    p.id === target?.id ? { ...p, amountCents: targetAmount } : p,
  );
  const now = Date.now();
  const auditId = `receipt-payment:${request.requestId}`;
  const details = JSON.stringify({
    requestId: request.requestId,
    before: payments,
    after,
    receipts,
    beforeTotalCents: sale.receivedTotalCents,
    afterTotalCents: total,
    targetPaymentId: target?.id ?? null,
  });
  await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
      SELECT ?, ?, ?, 'sale.payment_from_receipts', 'sale', ?, ?, ? WHERE
      EXISTS(SELECT 1 FROM sale_receipt_payment_sync WHERE sale_id=? AND store_id=? AND request_id=? AND status='pending')
      AND EXISTS(SELECT 1 FROM sales WHERE id=? AND store_id=? AND status='completed' AND received_total_cents=?)
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND store_id=? AND active=1 AND role=? AND permissions_json IS ?)
      AND ${paymentSnapshot}=? AND ${receiptSnapshot}=?`)
      .bind(
        auditId,
        storeId,
        request.requestedBy,
        saleId,
        details,
        now,
        saleId,
        storeId,
        request.requestId,
        saleId,
        storeId,
        sale.receivedTotalCents,
        request.requestedBy,
        storeId,
        actor!.role,
        actor!.permissionsJson,
        saleId,
        storeId,
        sale.paymentsJson,
        saleId,
        storeId,
        sale.receiptsJson,
      ),
    db
      .prepare(`UPDATE payments SET amount_cents=? WHERE id=? AND sale_id=? AND store_id=?
      AND EXISTS(SELECT 1 FROM sale_receipt_payment_sync WHERE sale_id=? AND request_id=? AND status='pending')
      AND EXISTS(SELECT 1 FROM audit_events WHERE id=? AND details_json=?)`)
      .bind(
        targetAmount,
        target?.id ?? '',
        saleId,
        storeId,
        saleId,
        request.requestId,
        auditId,
        details,
      ),
    db
      .prepare(`UPDATE sales SET received_total_cents=?, received_difference_cents=?-products_total_cents WHERE id=? AND store_id=?
      AND EXISTS(SELECT 1 FROM sale_receipt_payment_sync WHERE sale_id=? AND request_id=? AND status='pending')
      AND EXISTS(SELECT 1 FROM audit_events WHERE id=? AND details_json=?)`)
      .bind(
        total,
        total,
        saleId,
        storeId,
        saleId,
        request.requestId,
        auditId,
        details,
      ),
    db
      .prepare(`UPDATE sale_receipt_payment_sync SET status='applied', updated_at=? WHERE sale_id=? AND store_id=? AND request_id=? AND status='pending'
      AND EXISTS(SELECT 1 FROM audit_events WHERE id=? AND details_json=?)`)
      .bind(now, saleId, storeId, request.requestId, auditId, details),
  ]);
}

export async function processReceiptPaymentSync(db: D1Database) {
  const rows = await db
    .prepare(`SELECT q.sale_id AS saleId, q.store_id AS storeId FROM sale_receipt_payment_sync q
    JOIN sales s ON s.id=q.sale_id AND s.store_id=q.store_id WHERE q.status='pending' AND s.status='completed'
    AND EXISTS(SELECT 1 FROM attachments a WHERE a.sale_id=q.sale_id AND a.store_id=q.store_id AND a.kind='receipt')
    AND NOT EXISTS(SELECT 1 FROM attachments a WHERE a.sale_id=q.sale_id AND a.store_id=q.store_id AND a.kind='receipt' AND a.receipt_amount_cents IS NULL)
    ORDER BY q.updated_at LIMIT 10`)
    .all<{ saleId: string; storeId: string }>();
  for (const row of rows.results)
    await settleReceiptPaymentSync(db, row.storeId, row.saleId);
}
