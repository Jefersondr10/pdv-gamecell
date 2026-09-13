import { SALE_RECEIPT_TOTAL_SQL } from './sale-status-sql.ts';
import {
  can,
  resolvePermissions,
  type PermissionSubject,
} from '../permissions.ts';
import { paymentMethodTotals } from '../receipt-reconciliation.ts';
import {
  normalizeReceiptIdentity,
  parseReceiptDocument,
} from '../receipt-document.ts';
import { HttpError } from './http.ts';
import { settleAutomaticReceiptPayments } from './receipt-auto-payment.ts';
import { refreshStoreReceivedTotals } from './sale-received-totals.ts';
import {
  receiptEvidenceProblem,
  receiptConflictSql,
  receiptClaimStatements,
  receiptAllocationProblem,
} from './receipt-evidence-safety.ts';

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
  details?: string | null;
  review?: string | null;
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
  if (
    !can(scope.subject, 'sales.payments') &&
    !can(scope.subject, 'sales.receipts') &&
    !can(scope.subject, 'sell')
  )
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
export const receiptSnapshot = `(SELECT json_group_array(json_object('id',id,'amountCents',receipt_amount_cents,'source',receipt_amount_source,'confirmedAt',receipt_amount_confirmed_at,'details',receipt_details_json,'review',receipt_review_reason)) FROM (SELECT * FROM attachments WHERE sale_id=? AND store_id=? AND kind='receipt' ORDER BY id))`;

export async function readReceiptPaymentSync(
  db: D1Database,
  storeId: string,
  saleId: string,
) {
  const results = await db.batch([
    db
      .prepare(`SELECT status, products_total_cents AS productsTotalCents, received_total_cents AS receivedTotalCents, ${SALE_RECEIPT_TOTAL_SQL} AS effectiveReceiptTotalCents,
      received_difference_cents AS receivedDifferenceCents, ${paymentSnapshot} AS paymentsJson, ${receiptSnapshot} AS receiptsJson
      FROM sales s WHERE id=? AND store_id=?`)
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
        effectiveReceiptTotalCents: number;
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
    ...paymentMethodTotals(payments),
    receipts,
    complete,
    total,
    request: results[1].results[0] as RequestRow | undefined,
  };
}

export function publicReceiptPaymentState(
  state: NonNullable<Awaited<ReturnType<typeof readReceiptPaymentSync>>>,
) {
  const receiptTotal = state.sale.effectiveReceiptTotalCents;
  return {
    status: state.request?.status ?? 'manual',
    requestId: state.request?.requestId ?? null,
    updatedAt: state.request?.updatedAt ?? null,
    saleStatus: state.sale.status,
    receivedTotalCents: receiptTotal + state.cashCents,
    productsTotalCents: state.sale.productsTotalCents,
    receiptTotalCents: receiptTotal,
    pixCents: state.pixCents,
    cashCents: state.cashCents,
    complete: state.complete,
    payments: state.payments,
    expectedPayments: state.sale.paymentsJson,
    expectedReceipts: state.sale.receiptsJson,
  };
}

// Explicit first Pix: a receipt identifies the amount, never the destination account.
// The caller handles operation replay before invoking this atomic creation path.
export async function registerFirstReceiptPix(
  db: D1Database,
  scope: {
    storeId: string;
    saleId: string;
    actorId: string;
    subject: PermissionSubject;
  },
  state: NonNullable<Awaited<ReturnType<typeof readReceiptPaymentSync>>>,
  input: { operationId: string; pixAccountId: string; requestDetails: string },
  now: number,
) {
  const { storeId, saleId, actorId } = scope;
  if (
    !can(scope.subject, 'sales.payments') ||
    !can(scope.subject, 'sales.receipts')
  )
    throw new HttpError(
      403,
      'É necessário acesso a comprovantes e pagamentos.',
      'PERMISSION_DENIED',
    );
  if (
    state.sale.status !== 'completed' ||
    state.payments.some((p) => p.method === 'pix')
  )
    throw new HttpError(
      409,
      'A venda mudou. Atualize os pagamentos antes de registrar o Pix.',
      'SALE_CHANGED',
    );
  const receivedAfter = state.cashCents + state.total;
  const evidenceProblem = await receiptEvidenceProblem(
    db,
    storeId,
    saleId,
    state.receipts,
  );
  if (evidenceProblem)
    throw new HttpError(409, evidenceProblem, 'RECEIPT_REVIEW_REQUIRED');
  const allocationProblem = await receiptAllocationProblem(
    db,
    storeId,
    saleId,
    state.receipts,
    state.payments,
  );
  if (allocationProblem)
    throw new HttpError(409, allocationProblem, 'RECEIPT_REVIEW_REQUIRED');
  if (
    !state.complete ||
    !Number.isSafeInteger(state.total) ||
    state.total < 1 ||
    state.total > 1_000_000_000 ||
    !Number.isSafeInteger(receivedAfter) ||
    receivedAfter > 100_000_000_000
  )
    throw new HttpError(
      409,
      'Aguarde a leitura ou corrija os comprovantes antes de registrar o Pix.',
      'RECEIPTS_PENDING',
    );
  const account = await db
    .prepare(
      'SELECT name,receipt_bank AS bank,receipt_recipient_document AS document FROM pix_accounts WHERE id=? AND store_id=? AND active=1',
    )
    .bind(input.pixAccountId, storeId)
    .first<{ name: string; bank: string | null; document: string | null }>();
  if (!account)
    throw new HttpError(
      409,
      'Selecione uma conta Pix ativa desta loja.',
      'PIX_ACCOUNT_INVALID',
    );
  for (const receipt of state.receipts) {
    const doc = parseReceiptDocument(receipt.details);
    if (
      (doc?.recipientBank &&
        account.bank &&
        normalizeReceiptIdentity(doc.recipientBank) !==
          normalizeReceiptIdentity(account.bank)) ||
      (doc?.recipientDocument &&
        account.document &&
        doc.recipientDocument !== account.document)
    )
      throw new HttpError(
        409,
        'A conta escolhida não corresponde ao banco/recebedor identificado no comprovante.',
        'RECEIPT_ACCOUNT_MISMATCH',
      );
  }
  const actor = await db
    .prepare(
      'SELECT role,permissions_json AS permissionsJson,active FROM users WHERE id=? AND store_id=?',
    )
    .bind(actorId, storeId)
    .first<{
      role: PermissionSubject['role'];
      permissionsJson: string | null;
      active: number;
    }>();
  const actorSubject = actor && {
    role: actor.role,
    permissions: resolvePermissions(actor.role, actor.permissionsJson),
  };
  if (
    !actor ||
    actor.active !== 1 ||
    !actorSubject ||
    !can(actorSubject, 'sales.payments') ||
    !can(actorSubject, 'sales.receipts')
  )
    throw new HttpError(
      403,
      'Seu acesso a pagamentos ou comprovantes mudou.',
      'PERMISSION_DENIED',
    );
  const paymentId = crypto.randomUUID();
  const additionDetails = JSON.stringify({
    paymentId,
    method: 'pix',
    pixAccountId: input.pixAccountId,
    accountName: account.name,
    amountCents: state.total,
    previousReceivedCents: state.sale.receivedTotalCents,
    receivedTotalCents: receivedAfter,
    receiptRequestId: input.operationId,
    receipts: state.receipts,
  });
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO audit_events (id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
        VALUES(?,?,?,'sale.receipt_payment_requested','sale',CASE WHEN
        EXISTS(SELECT 1 FROM sales WHERE id=? AND store_id=? AND status='completed' AND received_total_cents=?)
        AND ${paymentSnapshot}=? AND ${receiptSnapshot}=?
        AND ${receiptConflictSql}
        AND NOT EXISTS(SELECT 1 FROM payments WHERE sale_id=? AND store_id=? AND method='pix')
        AND (SELECT request_id FROM sale_receipt_payment_sync WHERE sale_id=? AND store_id=?) IS ?
        AND EXISTS(SELECT 1 FROM pix_accounts WHERE id=? AND store_id=? AND active=1 AND name=? AND receipt_bank IS ? AND receipt_recipient_document IS ?)
        AND EXISTS(SELECT 1 FROM users WHERE id=? AND store_id=? AND active=1 AND role=? AND permissions_json IS ?)
        THEN ? ELSE NULL END,?,?)`)
        .bind(
          input.operationId,
          storeId,
          actorId,
          saleId,
          storeId,
          state.sale.receivedTotalCents,
          saleId,
          storeId,
          state.sale.paymentsJson,
          saleId,
          storeId,
          state.sale.receiptsJson,
          storeId,
          saleId,
          storeId,
          saleId,
          saleId,
          storeId,
          saleId,
          storeId,
          state.request?.requestId ?? null,
          input.pixAccountId,
          storeId,
          account.name,
          account.bank,
          account.document,
          actorId,
          storeId,
          actor.role,
          actor.permissionsJson,
          saleId,
          input.requestDetails,
          now,
        ),
      ...receiptClaimStatements(
        db,
        { ...scope, paymentIds: [paymentId] },
        state.receipts,
        input.operationId,
        input.requestDetails,
        now,
      ),
      db
        .prepare(`INSERT INTO payments(id,store_id,sale_id,method,pix_account_id,account_name,amount_cents,created_at)
        VALUES(?,?,?,'pix',?,?,?,?)`)
        .bind(
          paymentId,
          storeId,
          saleId,
          input.pixAccountId,
          account.name,
          state.total,
          now,
        ),
      db
        .prepare(`INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
        VALUES(?,?,?,'sale.payment_added','sale',?,?,?)`)
        .bind(paymentId, storeId, actorId, saleId, additionDetails, now),
      db
        .prepare(`INSERT INTO sale_receipt_payment_sync(sale_id,store_id,request_id,requested_by,target_payment_id,status,updated_at)
        VALUES(?,?,?,?,?,'applied',?) ON CONFLICT(sale_id) DO UPDATE SET request_id=excluded.request_id,
        requested_by=excluded.requested_by,target_payment_id=excluded.target_payment_id,status='applied',updated_at=excluded.updated_at`)
        .bind(saleId, storeId, input.operationId, actorId, paymentId, now),
      db
        .prepare(
          "UPDATE attachments SET receipt_review_reason=NULL WHERE sale_id=? AND store_id=? AND kind='receipt'",
        )
        .bind(saleId, storeId),
      refreshStoreReceivedTotals(db, storeId, {
        auditId: input.operationId,
        auditAction: 'sale.receipt_payment_requested',
        auditEntityId: saleId,
      }),
    ]);
  } catch (error) {
    if (error instanceof Error && /constraint failed/i.test(error.message))
      throw new HttpError(
        409,
        'A venda ou a conta mudou. Atualize e confira antes de registrar o Pix.',
        'SALE_CHANGED',
      );
    throw error;
  }
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
  const { sale, payments, receipts, complete, total, pixCents, cashCents } =
    current;
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
    (actor?.active === 1 &&
      can(
        {
          role: actor.role,
          permissions: resolvePermissions(actor.role, actor.permissionsJson),
        },
        'sales.receipts',
      )) ||
    (actor?.active === 1 &&
      can(
        {
          role: actor.role,
          permissions: resolvePermissions(actor.role, actor.permissionsJson),
        },
        'sell',
      )) ||
    (actor?.active === 1 &&
      can(
        {
          role: actor.role,
          permissions: resolvePermissions(actor.role, actor.permissionsJson),
        },
        'sales.payments',
      ));
  const pixPayments = payments.filter((p) => p.method === 'pix');
  if (
    allowed &&
    actor &&
    (await settleAutomaticReceiptPayments(db, storeId, saleId, current, actor))
  )
    return;
  const target = request.targetPaymentId
    ? pixPayments.find((p) => p.id === request.targetPaymentId)
    : pixPayments.length === 1
      ? pixPayments[0]
      : undefined;
  const targetAmount = target
    ? total -
      pixPayments
        .filter((p) => p.id !== target.id)
        .reduce((sum, p) => sum + p.amountCents, 0)
    : 0;
  const matched = total === pixCents;
  const receivedAfter = cashCents + total;
  if (
    !allowed ||
    pixPayments.length === 0 ||
    (request.targetPaymentId !== null && !target) ||
    (!matched &&
      (!target || targetAmount < 1 || targetAmount > 1_000_000_000)) ||
    !Number.isSafeInteger(total) ||
    total > 100_000_000_000 ||
    !Number.isSafeInteger(receivedAfter) ||
    receivedAfter > 100_000_000_000
  ) {
    await db.batch([
      db
        .prepare(
          `UPDATE sale_receipt_payment_sync SET status='review', updated_at=? WHERE sale_id=? AND store_id=? AND request_id=? AND status='pending'`,
        )
        .bind(Date.now(), saleId, storeId, request.requestId),
      refreshStoreReceivedTotals(db, storeId, {
        receiptSyncSaleId: saleId,
        receiptSyncRequestId: request.requestId,
        receiptSyncStatus: 'review',
      }),
    ]);
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
    afterTotalCents: receivedAfter,
    pixTotalCents: total,
    cashPreservedCents: cashCents,
    targetPaymentId: target?.id ?? null,
  });
  await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
      SELECT ?, ?, ?, 'sale.payment_from_receipts', 'sale', ?, ?, ? WHERE
      EXISTS(SELECT 1 FROM sale_receipt_payment_sync WHERE sale_id=? AND store_id=? AND request_id=? AND status='pending')
      AND EXISTS(SELECT 1 FROM sales WHERE id=? AND store_id=? AND status='completed' AND received_total_cents=?)
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND store_id=? AND active=1 AND role=? AND permissions_json IS ?)
      AND ${paymentSnapshot}=? AND ${receiptSnapshot}=? AND ${receiptConflictSql}`)
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
        storeId,
        saleId,
        storeId,
        saleId,
      ),
    ...receiptClaimStatements(
      db,
      {
        storeId,
        saleId,
        actorId: request.requestedBy,
        paymentIds: pixPayments.map((p) => p.id),
      },
      receipts,
      auditId,
      details,
      now,
    ),
    db
      .prepare(`UPDATE payments SET amount_cents=? WHERE id=? AND sale_id=? AND store_id=? AND method='pix'
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
      .prepare(`UPDATE attachments SET receipt_review_reason=NULL WHERE sale_id=? AND store_id=? AND kind='receipt'
      AND EXISTS(SELECT 1 FROM sale_receipt_payment_sync WHERE sale_id=? AND request_id=? AND status='pending')
      AND EXISTS(SELECT 1 FROM audit_events WHERE id=? AND details_json=?)`)
      .bind(saleId, storeId, saleId, request.requestId, auditId, details),
    refreshStoreReceivedTotals(db, storeId, {
      auditId,
      auditAction: 'sale.payment_from_receipts',
      auditEntityId: saleId,
      auditDetails: details,
    }),
    db
      .prepare(`UPDATE sale_receipt_payment_sync SET status='applied', updated_at=? WHERE sale_id=? AND store_id=? AND request_id=? AND status='pending'
      AND EXISTS(SELECT 1 FROM audit_events WHERE id=? AND details_json=?)`)
      .bind(now, saleId, storeId, request.requestId, auditId, details),
  ]);
}

export async function processReceiptPaymentSync(db: D1Database) {
  // A terminal OCR failure is review, not an endlessly pending settlement.
  const terminalCondition = `EXISTS(SELECT 1 FROM sales s WHERE s.id=q.sale_id AND s.store_id=q.store_id AND s.status='completed')
    AND EXISTS(SELECT 1 FROM attachments a WHERE a.sale_id=q.sale_id AND a.store_id=q.store_id AND a.kind='receipt' AND a.receipt_amount_cents IS NULL)
    AND NOT EXISTS(SELECT 1 FROM attachments a LEFT JOIN receipt_ocr_jobs j ON j.attachment_id=a.id
      WHERE a.sale_id=q.sale_id AND a.store_id=q.store_id AND a.kind='receipt'
      AND (j.status IN ('pending','processing','retry') OR (j.attachment_id IS NULL AND a.receipt_amount_cents IS NULL)))`;
  const terminal = await db
    .prepare(`SELECT q.sale_id AS saleId,q.store_id AS storeId,q.request_id AS requestId
      FROM sale_receipt_payment_sync q WHERE q.status='pending' AND ${terminalCondition}`)
    .all<{ saleId: string; storeId: string; requestId: string }>();
  for (const row of terminal.results) {
    const updatedAt = Date.now();
    await db.batch([
      db
        .prepare(`UPDATE sale_receipt_payment_sync AS q SET status='review',updated_at=?
          WHERE q.sale_id=? AND q.store_id=? AND q.request_id=? AND q.status='pending'
          AND ${terminalCondition}`)
        .bind(updatedAt, row.saleId, row.storeId, row.requestId),
      refreshStoreReceivedTotals(db, row.storeId, {
        receiptSyncSaleId: row.saleId,
        receiptSyncRequestId: row.requestId,
        receiptSyncStatus: 'review',
      }),
    ]);
  }
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
