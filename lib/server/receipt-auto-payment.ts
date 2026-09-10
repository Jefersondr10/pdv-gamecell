import {
  normalizeReceiptIdentity,
  parseReceiptDocument,
} from '../receipt-document.ts';
import type { readReceiptPaymentSync } from './receipt-payment-sync.ts';
import {
  receiptEvidenceProblem,
  receiptConflictSql,
  receiptAllocationProblem,
} from './receipt-evidence-safety.ts';

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
  const review = async (reason: string) => {
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
            JSON.stringify({ reason }),
            now,
          ),
        db
          .prepare(`UPDATE attachments SET receipt_review_reason=? WHERE sale_id=? AND store_id=? AND kind='receipt'
        AND EXISTS(SELECT 1 FROM sale_receipt_payment_sync WHERE sale_id=? AND request_id=? AND status='pending')`)
          .bind(reason, saleId, storeId, saleId, request.requestId),
        db
          .prepare(
            `UPDATE sale_receipt_payment_sync SET status='review',updated_at=? WHERE sale_id=? AND store_id=? AND request_id=? AND status='pending'`,
          )
          .bind(Date.now(), saleId, storeId, request.requestId),
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
  const evidenceProblem = await receiptEvidenceProblem(
    db,
    storeId,
    saleId,
    receipts,
  );
  if (evidenceProblem) return review(evidenceProblem);
  const allocationProblem = await receiptAllocationProblem(
    db,
    storeId,
    saleId,
    receipts,
    current.payments,
  );
  if (allocationProblem) return review(allocationProblem);
  if (documents.some((d) => d && ['scheduled', 'cancelled'].includes(d.state)))
    return review(
      'O documento indica agendamento, cancelamento ou estorno. Confira o pagamento.',
    );
  const ids = documents.map((d) => d?.transactionId).filter(Boolean);
  if (new Set(ids).size !== ids.length)
    return review(
      'Há comprovantes da mesma transação nesta venda. Confira os anexos duplicados.',
    );
  if (links.some((l) => !pix.some((p) => p.id === l.paymentId)))
    return review(
      'O pagamento deste comprovante foi alterado manualmente. Confira os pagamentos; dinheiro não será convertido em Pix.',
    );
  if (links.some((l) => !receipts.some((r) => r.id === l.attachmentId)))
    return review(
      'Um comprovante de Pix registrado foi excluído. Confira o pagamento antes de substituir o anexo.',
    );
  // The established explicit/manual allocation path remains available for old sales.
  if (
    request.targetPaymentId ||
    pix.some((p) => !links.some((l) => l.paymentId === p.id))
  ) {
    for (const doc of documents) {
      const matches =
        doc?.recipientBank && doc.recipientDocument
          ? accounts.filter(
              (a) =>
                a.active === 1 &&
                a.bank &&
                a.document &&
                normalizeReceiptIdentity(a.bank) ===
                  normalizeReceiptIdentity(doc.recipientBank!) &&
                a.document === doc.recipientDocument,
            )
          : [];
      if (
        matches.length === 1 &&
        !pix.some((p) => p.pixAccountId === matches[0].id)
      )
        return review(
          'O banco/recebedor do comprovante não corresponde à conta do Pix informado. Confira a conta do pagamento.',
        );
    }
    return false;
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
    if (
      !doc ||
      !doc.automaticEligible ||
      doc.state !== 'completed' ||
      !doc.transactionId ||
      !/^E[A-Za-z0-9]{31}$/.test(doc.transactionId) ||
      !doc.recipientBank ||
      !doc.recipientDocument ||
      (!link && receipt.source !== 'ocr')
    )
      return review(
        'Confira o recebedor e registre o Pix: a leitura não identificou todos os dados da transação com segurança.',
      );
    if (link && link.transactionId !== doc.transactionId)
      return review(
        'A identificação da transação mudou na releitura. Confira o pagamento registrado.',
      );
    const matches = accounts.filter(
      (a) =>
        a.active === 1 &&
        a.bank &&
        a.document &&
        normalizeReceiptIdentity(a.bank) ===
          normalizeReceiptIdentity(doc.recipientBank!) &&
        a.document === doc.recipientDocument,
    );
    if (matches.length !== 1)
      return review(
        matches.length
          ? 'Mais de uma conta corresponde ao recebedor. Escolha a conta ao conferir o Pix.'
          : 'Conta recebedora não identificada no cadastro. Confira o banco e CPF/CNPJ da conta ou registre o Pix manualmente.',
      );
    const claim = await db
      .prepare(
        'SELECT attachment_id AS attachmentId FROM receipt_payment_links WHERE store_id=? AND transaction_id=?',
      )
      .bind(storeId, doc.transactionId)
      .first<{ attachmentId: string }>();
    if (claim && claim.attachmentId !== receipt.id)
      return review(
        'Esta transação já foi registrada por outro comprovante. Ela não será somada novamente.',
      );
    planned.push({
      receipt,
      document: doc,
      account: matches[0],
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
            p.document.transactionId,
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
        'UPDATE sales SET received_total_cents=?,received_difference_cents=?-products_total_cents WHERE id=? AND store_id=?',
      )
      .bind(received, received, saleId, storeId),
  );
  statements.push(
    db
      .prepare(
        `UPDATE sales SET received_total_cents=CASE WHEN (SELECT SUM(amount_cents) FROM payments WHERE sale_id=? AND store_id=?)=? THEN received_total_cents ELSE NULL END WHERE id=? AND store_id=?`,
      )
      .bind(saleId, storeId, received, saleId, storeId),
  );
  statements.push(
    db
      .prepare(
        "UPDATE attachments SET receipt_review_reason=NULL WHERE sale_id=? AND store_id=? AND kind='receipt'",
      )
      .bind(saleId, storeId),
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
