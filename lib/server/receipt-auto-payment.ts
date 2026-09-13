import {
  normalizeReceiptIdentity,
  parseReceiptDocument,
} from '../receipt-document.ts';
import type { readReceiptPaymentSync } from './receipt-payment-sync.ts';
import {
  receiptEvidenceProblem,
  receiptConflictSql,
  receiptAllocationProblem,
  receiptClaimStatements,
} from './receipt-evidence-safety.ts';
import {
  duplicateReceiptSql,
  effectiveReceiptReviewReasonSql,
  invalidReceiptDocumentSql,
  linkedReceiptPaymentSql,
} from './sale-status-sql.ts';
import { refreshStoreReceivedTotals } from './sale-received-totals.ts';

type State = NonNullable<Awaited<ReturnType<typeof readReceiptPaymentSync>>>;
type Actor = { role: string; permissionsJson: string | null };
type Evidence = {
  id: string;
  amount: number;
  source: string | null;
  details: string | null;
  review: string | null;
};
type Account = {
  id: string;
  name: string;
  bank: string | null;
  document: string | null;
  active: number;
};
type Link = { attachmentId: string; paymentId: string; transactionId: string };

// Include this in the attachment mutation's batch. It clears only obsolete
// evidence warnings, never a manual-payment/allocation warning or a payment.
export function cleanupResolvedReceiptReviews(
  db: D1Database,
  storeId: string,
  saleId: string,
  guardAuditId?: string,
) {
  return db
    .prepare(`UPDATE attachments AS ar
    SET receipt_review_reason=${effectiveReceiptReviewReasonSql('ar')}
    WHERE ar.store_id=? AND ar.sale_id=? AND ar.kind='receipt'
    AND ar.receipt_review_reason IS NOT NULL
    AND (? IS NULL OR EXISTS(SELECT 1 FROM audit_events cleanup_guard WHERE cleanup_guard.id=? AND cleanup_guard.store_id=ar.store_id AND cleanup_guard.entity_id=ar.sale_id))`)
    .bind(storeId, saleId, guardAuditId ?? null, guardAuditId ?? null);
}

// New receipt-driven payments use one durable evidence claim per Pix. Legacy
// manually entered Pix payments are never imported a second time.
export async function settleAutomaticReceiptPayments(
  db: D1Database,
  storeId: string,
  saleId: string,
  current: State,
  actor: Actor,
) {
  const request = current.request!;
  const evidenceSql = `SELECT json_group_array(json_object('id',id,'amount',receipt_amount_cents,'source',receipt_amount_source,'details',receipt_details_json,'review',receipt_review_reason)) AS snapshot FROM (SELECT * FROM attachments WHERE sale_id=? AND store_id=? AND kind='receipt' ORDER BY id)`;
  const accountsSql = `SELECT json_group_array(json_object('id',id,'name',name,'bank',receipt_bank,'document',receipt_recipient_document,'active',active)) AS snapshot FROM (SELECT * FROM pix_accounts WHERE store_id=? ORDER BY id)`;
  const linkSql = `SELECT json_group_array(json_object('attachmentId',attachment_id,'paymentId',payment_id,'transactionId',transaction_id)) AS snapshot FROM (SELECT * FROM receipt_payment_links WHERE sale_id=? AND store_id=? ORDER BY attachment_id)`;
  const snapshots = await db.batch([
    db.prepare(evidenceSql).bind(saleId, storeId),
    db.prepare(accountsSql).bind(storeId),
    db.prepare(linkSql).bind(saleId, storeId),
  ]);
  const evidenceJson = (snapshots[0].results[0] as { snapshot: string })
    .snapshot;
  const accountsJson = (snapshots[1].results[0] as { snapshot: string })
    .snapshot;
  const linksJson = (snapshots[2].results[0] as { snapshot: string }).snapshot;
  const receipts: Evidence[] = JSON.parse(evidenceJson);
  const accounts: Account[] = JSON.parse(accountsJson);
  const links: Link[] = JSON.parse(linksJson);
  const pix = current.payments.filter((p) => p.method === 'pix');
  const review = async (
    reason: string,
    affectedIds = receipts.map((r) => r.id),
  ) => {
    const now = Date.now();
    try {
      await db.batch([
        db
          .prepare(`INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,'sale.receipt_review','sale',CASE WHEN
        EXISTS(SELECT 1 FROM sale_receipt_payment_sync WHERE sale_id=? AND store_id=? AND request_id=? AND status='pending') AND (${evidenceSql})=? THEN ? ELSE NULL END,?,?)`)
          .bind(
            `receipt-review:${request.requestId}`,
            storeId,
            request.requestedBy,
            saleId,
            storeId,
            request.requestId,
            saleId,
            storeId,
            evidenceJson,
            saleId,
            JSON.stringify({ reason, receiptIds: affectedIds }),
            now,
          ),
        db
          .prepare(`UPDATE attachments AS ar SET receipt_review_reason=CASE WHEN ar.id IN (SELECT value FROM json_each(?)) THEN ? ELSE ${effectiveReceiptReviewReasonSql('ar')} END WHERE sale_id=? AND store_id=? AND kind='receipt'
        AND EXISTS(SELECT 1 FROM sale_receipt_payment_sync WHERE sale_id=? AND request_id=? AND status='pending')`)
          .bind(
            JSON.stringify(affectedIds),
            reason,
            saleId,
            storeId,
            saleId,
            request.requestId,
          ),
        db
          .prepare(
            `UPDATE sale_receipt_payment_sync SET status='review',updated_at=? WHERE sale_id=? AND store_id=? AND request_id=? AND status='pending'`,
          )
          .bind(Date.now(), saleId, storeId, request.requestId),
        refreshStoreReceivedTotals(db, storeId, {
          auditId: `receipt-review:${request.requestId}`,
          auditAction: 'sale.receipt_review',
          auditEntityId: saleId,
        }),
      ]);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/constraint failed/i.test(error.message)
      )
        throw error;
    }
    return true;
  };
  const documents = receipts.map((r) => parseReceiptDocument(r.details));
  const malformedIds = receipts
    .filter((r, index) => r.details !== null && !documents[index])
    .map((r) => r.id);
  if (malformedIds.length)
    return review(
      'A leitura não identificou uma transação concluída com segurança. Releia o comprovante.',
      malformedIds,
    );
  const evidenceProblem = await receiptEvidenceProblem(
    db,
    storeId,
    saleId,
    receipts,
  );
  if (evidenceProblem) {
    const affected = await db
      .prepare(
        `SELECT ar.id FROM attachments ar WHERE ar.store_id=? AND ar.sale_id=? AND ar.kind='receipt' AND (${invalidReceiptDocumentSql('ar')} OR ${duplicateReceiptSql('ar')})`,
      )
      .bind(storeId, saleId)
      .all<{ id: string }>();
    return review(
      evidenceProblem,
      affected.results.map((r) => r.id),
    );
  }
  const allocationProblem = await receiptAllocationProblem(
    db,
    storeId,
    saleId,
    receipts,
    current.payments,
  );
  if (allocationProblem) {
    const claims = await db
      .prepare(`SELECT entity_id AS attachmentId,details_json AS details FROM audit_events
        WHERE store_id=? AND action='sale.receipt_transaction_claimed' AND json_valid(details_json) AND json_extract(details_json,'$.saleId')=?`)
      .bind(storeId, saleId)
      .all<{ attachmentId: string; details: string }>();
    const affectedIds = claims.results
      .filter((claim) => {
        if (!receipts.some((receipt) => receipt.id === claim.attachmentId))
          return false;
        const { paymentIds } = JSON.parse(claim.details) as {
          paymentIds?: unknown;
        };
        return (
          !Array.isArray(paymentIds) ||
          !paymentIds.length ||
          paymentIds.some(
            (id) =>
              typeof id !== 'string' ||
              !pix.some((payment) => payment.id === id),
          )
        );
      })
      .map((claim) => claim.attachmentId);
    return review(allocationProblem, affectedIds);
  }
  if (documents.some((d) => d && ['scheduled', 'cancelled'].includes(d.state)))
    return review(
      'O documento indica agendamento, cancelamento ou estorno. Confira o pagamento.',
    );
  const ids = documents.map((d) => d?.transactionId).filter(Boolean);
  if (new Set(ids).size !== ids.length)
    return review(
      'Há comprovantes da mesma transação nesta venda. Confira os anexos duplicados.',
    );
  const missingPayments = links.filter(
    (l) => !pix.some((p) => p.id === l.paymentId),
  );
  if (missingPayments.length)
    return review(
      'O pagamento deste comprovante foi alterado manualmente. Confira os pagamentos; dinheiro não será convertido em Pix.',
      missingPayments.map((link) => link.attachmentId),
    );
  const historicallyLinked = await db
    .prepare(
      `SELECT ar.id FROM attachments ar WHERE ar.store_id=? AND ar.sale_id=? AND ar.kind='receipt' AND ${linkedReceiptPaymentSql('ar')} IS NOT NULL`,
    )
    .bind(storeId, saleId)
    .all<{ id: string }>();
  const historicallyLinkedIds = new Set(
    historicallyLinked.results.map((row) => row.id),
  );
  const unsafeAutomaticIds = receipts
    .filter(
      (receipt, index) =>
        receipt.details !== null &&
        !documents[index]?.automaticEligible &&
        !historicallyLinkedIds.has(receipt.id),
    )
    .map((receipt) => receipt.id);
  if (unsafeAutomaticIds.length)
    return review(
      'A leitura não contém identificação suficiente para conciliação automática. Releia o comprovante.',
      unsafeAutomaticIds,
    );
  // The established explicit/manual allocation path remains available for old sales.
  if (
    request.targetPaymentId ||
    pix.some((p) => !links.some((l) => l.paymentId === p.id))
  ) {
    // Legacy Pix entries are historical, not a second amount to reconcile.
    // Preserve them, claim the evidence, and let the shared receipt-income model
    // expose receipts + cash. No account selection or allocation is required.
    const auditId = `receipt-verified:${request.requestId}`;
    const now = Date.now();
    const details = JSON.stringify({
      receiptIds: receipts.map((r) => r.id),
      source: 'receipt-income',
    });
    try {
      await db.batch([
        db
          .prepare(`INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
          VALUES(?,?,?,'sale.receipts_verified','sale',CASE WHEN
          EXISTS(SELECT 1 FROM sale_receipt_payment_sync WHERE sale_id=? AND store_id=? AND request_id=? AND status='pending')
          AND EXISTS(SELECT 1 FROM sales WHERE id=? AND store_id=? AND status='completed')
          AND (${evidenceSql})=? AND ${receiptConflictSql}
          THEN ? ELSE NULL END,?,?)`)
          .bind(
            auditId,
            storeId,
            request.requestedBy,
            saleId,
            storeId,
            request.requestId,
            saleId,
            storeId,
            saleId,
            storeId,
            evidenceJson,
            storeId,
            saleId,
            storeId,
            saleId,
            saleId,
            details,
            now,
          ),
        ...receiptClaimStatements(
          db,
          {
            storeId,
            saleId,
            actorId: request.requestedBy,
            paymentIds: pix.map((p) => p.id),
          },
          receipts,
          auditId,
          details,
          now,
        ),
        db
          .prepare(
            "UPDATE attachments SET receipt_review_reason=NULL WHERE sale_id=? AND store_id=? AND kind='receipt'",
          )
          .bind(saleId, storeId),
        refreshStoreReceivedTotals(db, storeId, {
          auditId,
          auditAction: 'sale.receipts_verified',
          auditEntityId: saleId,
          auditDetails: details,
        }),
        db
          .prepare(
            "UPDATE sale_receipt_payment_sync SET status='applied',updated_at=? WHERE sale_id=? AND store_id=? AND request_id=?",
          )
          .bind(now, saleId, storeId, request.requestId),
      ]);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/constraint failed/i.test(error.message)
      )
        throw error;
    }
    return true;
  }
  if (
    !receipts.length ||
    receipts.some(
      (r) =>
        !Number.isSafeInteger(r.amount) ||
        r.amount <= 0 ||
        r.amount > 1_000_000_000,
    )
  )
    return true;
  const planned = [];
  for (let i = 0; i < receipts.length; i++) {
    const receipt = receipts[i];
    const doc = documents[i];
    const link = links.find((l) => l.attachmentId === receipt.id);
    if (doc && (doc.blocked || doc.ambiguous || doc.state !== 'completed'))
      return review(
        'A leitura não identificou uma transação concluída com segurança. Releia o comprovante.',
        [receipt.id],
      );
    const transactionId = doc?.transactionId ?? `receipt:${receipt.id}`;
    if (
      link &&
      link.transactionId !== transactionId &&
      link.transactionId !== `receipt:${receipt.id}`
    )
      return review(
        'A identificação da transação mudou na releitura. Confira o pagamento registrado.',
        [receipt.id],
      );
    const matches = accounts.filter(
      (a) =>
        a.active === 1 &&
        a.bank &&
        a.document &&
        normalizeReceiptIdentity(a.bank) ===
          normalizeReceiptIdentity(doc?.recipientBank ?? '') &&
        a.document === doc?.recipientDocument,
    );
    const account =
      matches.length === 1
        ? matches[0]
        : { id: null, name: doc?.recipientBank || 'Banco não identificado' };
    const claim = await db
      .prepare(
        'SELECT attachment_id AS attachmentId FROM receipt_payment_links WHERE store_id=? AND transaction_id=?',
      )
      .bind(storeId, transactionId)
      .first<{ attachmentId: string }>();
    if (claim && claim.attachmentId !== receipt.id)
      return review(
        'Esta transação já foi registrada por outro comprovante. Ela não será somada novamente.',
        [receipt.id],
      );
    planned.push({
      receipt,
      transactionId,
      account,
      link,
      paymentId: link?.paymentId ?? crypto.randomUUID(),
    });
  }
  const received =
    current.cashCents + planned.reduce((sum, p) => sum + p.receipt.amount, 0);
  if (!Number.isSafeInteger(received) || received > 100_000_000_000)
    return review('Valor fora do limite. Confira os pagamentos.');
  const now = Date.now();
  const auditId = `receipt-auto:${request.requestId}`;
  const paymentSql = `(SELECT json_group_array(json_object('id',id,'method',method,'pixAccountId',pix_account_id,'accountName',account_name,'amountCents',amount_cents)) FROM (SELECT * FROM payments WHERE sale_id=? AND store_id=? ORDER BY id))`;
  const statements = [
    db
      .prepare(`INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
    VALUES(?,?,?,'sale.payment_from_receipts','sale',CASE WHEN
    EXISTS(SELECT 1 FROM sale_receipt_payment_sync WHERE sale_id=? AND store_id=? AND request_id=? AND status='pending')
    AND EXISTS(SELECT 1 FROM sales WHERE id=? AND store_id=? AND status='completed' AND received_total_cents=?)
    AND EXISTS(SELECT 1 FROM users WHERE id=? AND store_id=? AND active=1 AND role=? AND permissions_json IS ?)
    AND ${paymentSql}=? AND (${evidenceSql})=? AND (${accountsSql})=? AND (${linkSql})=?
    AND ${receiptConflictSql}
    THEN ? ELSE NULL END,?,?)`)
      .bind(
        auditId,
        storeId,
        request.requestedBy,
        saleId,
        storeId,
        request.requestId,
        saleId,
        storeId,
        current.sale.receivedTotalCents,
        request.requestedBy,
        storeId,
        actor.role,
        actor.permissionsJson,
        saleId,
        storeId,
        current.sale.paymentsJson,
        saleId,
        storeId,
        evidenceJson,
        storeId,
        accountsJson,
        saleId,
        storeId,
        linksJson,
        storeId,
        saleId,
        storeId,
        saleId,
        saleId,
        JSON.stringify({
          before: current.payments,
          receiptIds: receipts.map((r) => r.id),
          receivedTotalCents: received,
          cashPreservedCents: current.cashCents,
        }),
        now,
      ),
  ];
  for (const p of planned) {
    if (p.link) {
      if (p.link.transactionId !== p.transactionId)
        statements.push(
          db
            .prepare(`UPDATE receipt_payment_links SET transaction_id=?
          WHERE attachment_id=? AND store_id=? AND sale_id=? AND payment_id=? AND transaction_id=?`)
            .bind(
              p.transactionId,
              p.receipt.id,
              storeId,
              saleId,
              p.paymentId,
              `receipt:${p.receipt.id}`,
            ),
        );
      statements.push(
        db
          .prepare(
            `UPDATE payments SET amount_cents=?,pix_account_id=?,account_name=? WHERE id=? AND sale_id=? AND store_id=? AND method='pix'`,
          )
          .bind(
            p.receipt.amount,
            p.account.id,
            p.account.name,
            p.paymentId,
            saleId,
            storeId,
          ),
      );
    } else {
      statements.push(
        db
          .prepare(
            `INSERT INTO payments(id,store_id,sale_id,method,pix_account_id,account_name,amount_cents,created_at) VALUES(?,?,?,'pix',?,?,?,?)`,
          )
          .bind(
            p.paymentId,
            storeId,
            saleId,
            p.account.id,
            p.account.name,
            p.receipt.amount,
            now,
          ),
      );
      statements.push(
        db
          .prepare(
            `INSERT INTO receipt_payment_links(attachment_id,store_id,sale_id,payment_id,transaction_id,created_at) VALUES(?,?,?,?,?,?)`,
          )
          .bind(
            p.receipt.id,
            storeId,
            saleId,
            p.paymentId,
            p.transactionId,
            now,
          ),
      );
      statements.push(
        db
          .prepare(
            `INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,'sale.payment_added','sale',?,?,?)`,
          )
          .bind(
            p.paymentId,
            storeId,
            request.requestedBy,
            saleId,
            JSON.stringify({
              paymentId: p.paymentId,
              method: 'pix',
              pixAccountId: p.account.id,
              accountName: p.account.name,
              amountCents: p.receipt.amount,
              attachmentId: p.receipt.id,
            }),
            now,
          ),
      );
    }
  }
  statements.push(
    db
      .prepare(
        "UPDATE attachments SET receipt_review_reason=NULL WHERE sale_id=? AND store_id=? AND kind='receipt'",
      )
      .bind(saleId, storeId),
  );
  statements.push(
    refreshStoreReceivedTotals(db, storeId, {
      auditId,
      auditAction: 'sale.payment_from_receipts',
      auditEntityId: saleId,
    }),
  );
  statements.push(
    db
      .prepare(
        "UPDATE sale_receipt_payment_sync SET status='applied',updated_at=? WHERE sale_id=? AND store_id=? AND request_id=?",
      )
      .bind(now, saleId, storeId, request.requestId),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    // A concurrent upload, manual edit, account change or duplicate transaction
    // rolls back the entire batch. Never leave a payment without its sale total.
    if (
      !(error instanceof Error) ||
      !/constraint failed|unique constraint/i.test(error.message)
    )
      throw error;
  }
  return true;
}
