import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import {
  parseReceiptDocument,
  type ReceiptDocument,
} from '../lib/receipt-document.ts';
import { saleReceiptIncome } from '../lib/receipt-income.ts';
import { DERIVED_RECEIPT_REVIEW_REASONS } from '../lib/receipt-review-reasons.ts';
import { deriveReceiptReconciliation } from '../lib/receipt-reconciliation.ts';
import { saleIssues } from '../lib/sale-display-status.ts';
import { cleanupResolvedReceiptReviews } from '../lib/server/receipt-auto-payment.ts';
import {
  readReceiptPaymentSync,
  requestReceiptPaymentSync,
  settleReceiptPaymentSync,
} from '../lib/server/receipt-payment-sync.ts';
import {
  effectiveReceiptReviewReasonSql,
  RECEIPT_ACTIVITY_SQL,
  SALE_RECEIVED_TOTAL_SQL,
  SALE_ISSUE_SQL,
} from '../lib/server/sale-status-sql.ts';

const validDocument: ReceiptDocument = {
  version: 1,
  state: 'completed',
  automaticEligible: true,
  blocked: false,
  ambiguous: false,
  payerName: null,
  payerBank: null,
  recipientName: null,
  recipientBank: null,
  recipientDocument: null,
  transactionId: 'E0000000000000000000000000000001',
  alternateTransactionId: null,
  observedTransactionId: null,
  paidAtText: null,
};
let adapter = new SqliteDatabase(':memory:');
let db = adapter as unknown as D1Database;
const scope = {
  storeId: 'shop',
  saleId: 'sale',
  actorId: 'owner',
  subject: { role: 'owner' as const },
};
function seed() {
  adapter?.close();
  adapter = new SqliteDatabase(':memory:');
  db = adapter as unknown as D1Database;
  for (const file of readdirSync('drizzle')
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort())
    adapter.database.exec(readFileSync(`drizzle/${file}`, 'utf8'));
  adapter.database.exec(`
    INSERT INTO stores(id,name,code,created_at,updated_at) VALUES('shop','Test','TEST',1,1),('other','Other','OTHER',1,1);
    INSERT INTO users(id,store_id,role,auth_kind,display_name,created_at,updated_at) VALUES('owner','shop','owner','password','Test',1,1);
    INSERT INTO sales(id,store_id,number,customer_name,seller_user_id,seller_name,products_total_cents,received_total_cents,received_difference_cents,reference_total_cents,price_difference_cents,created_at)
      VALUES('sale','shop',1,'Test','owner','Test',710000,300000,-410000,710000,0,1);
    INSERT INTO payments(id,store_id,sale_id,method,amount_cents,created_at) VALUES('cash','shop','sale','cash',300000,1);
  `);
}
function receipt(
  id = 'receipt',
  details: string | null = JSON.stringify(validDocument),
  amount: number | null = 410000,
) {
  adapter.database
    .prepare(`INSERT INTO attachments(id,store_id,kind,sale_id,r2_key,file_name,mime_type,size_bytes,receipt_amount_cents,receipt_amount_source,receipt_amount_confirmed_at,receipt_details_json,created_by,created_at)
    VALUES(?,'shop','receipt','sale',?,?,'image/png',4,?,'ocr',1,?,'owner',1)`)
    .run(id, id, id, amount, details);
}
function flags() {
  return adapter.database
    .prepare(
      `SELECT ${SALE_RECEIVED_TOTAL_SQL} AS received, ${SALE_ISSUE_SQL.review} AS review, ${SALE_ISSUE_SQL.reading} AS reading FROM sales s WHERE s.id='sale'`,
    )
    .get() as { received: number; review: number; reading: number };
}
async function sync() {
  await db.batch(
    requestReceiptPaymentSync(db, scope, crypto.randomUUID(), Date.now()),
  );
  await settleReceiptPaymentSync(db, 'shop', 'sale');
}
function parity(raw: string | null, amount: number | null, status?: string) {
  const parsed = parseReceiptDocument(raw);
  // API hydration must preserve invalid-vs-absent provenance. A failed parse
  // of present JSON is a blocked unknown document, not a legacy null receipt.
  const document =
    parsed ??
    (raw === null
      ? null
      : {
          ...validDocument,
          state: 'unknown' as const,
          blocked: true,
          automaticEligible: false,
        });
  const receipts = [
    {
      receiptAmountCents: amount,
      receiptDetails: document,
      receiptOcrStatus: status,
    },
  ];
  const sale = {
    status: 'completed' as const,
    productsTotalCents: 710000,
    receivedTotalCents: 300000,
    payments: [{ method: 'cash', amountCents: 300000 }],
    receipts,
    items: [],
    reconciliation: deriveReceiptReconciliation(receipts, 410000),
  };
  const issues = saleIssues(sale).map((issue) => issue.key);
  const sql = flags();
  assert.equal(
    sql.received,
    saleReceiptIncome(sale).receivedTotalCents,
    'SQL and fail-closed DTO income',
  );
  assert.equal(
    Boolean(sql.review),
    issues.includes('review'),
    `SQL and DTO review: ${String(raw).slice(0, 120)} amount=${amount}`,
  );
  assert.equal(
    Boolean(sql.reading),
    issues.includes('reading'),
    'SQL and DTO reading',
  );
}

// Stored amount alone is insufficient evidence. Malformed non-null JSON is
// rejected, while absent metadata remains compatible with old manual receipts.
for (const raw of [
  null,
  JSON.stringify(validDocument),
  '{',
  '{}',
  'null',
  '[]',
  '1',
  JSON.stringify({ version: 1, state: 'completed' }),
  JSON.stringify({ ...validDocument, version: '1' }),
  JSON.stringify({ ...validDocument, payerBank: 42 }),
  JSON.stringify({ ...validDocument, recipientName: 'A'.repeat(151) }),
  JSON.stringify({ ...validDocument, payerName: 'á'.repeat(150) }),
  JSON.stringify({ ...validDocument, payerName: '🙂'.repeat(75) }),
  JSON.stringify({ ...validDocument, payerName: '🙂'.repeat(76) }),
  JSON.stringify({ ...validDocument, payerName: '\u0000'.repeat(151) }),
  ...['unknown', 'scheduled', 'cancelled'].map((state) =>
    JSON.stringify({ ...validDocument, state }),
  ),
  JSON.stringify({ ...validDocument, blocked: true }),
  JSON.stringify({ ...validDocument, ambiguous: true }),
  JSON.stringify({ ...validDocument, automaticEligible: false }),
  JSON.stringify({ ...validDocument, blocked: 1, ambiguous: 'true' }),
]) {
  for (const amount of [410000, null]) {
    seed();
    receipt('receipt', raw, amount);
    adapter.database.exec(
      `INSERT INTO receipt_ocr_jobs(attachment_id,status,next_attempt_at,created_at,updated_at) VALUES('receipt','pending',1,1,1)`,
    );
    parity(raw, amount, 'pending');
  }
}
seed();
receipt('receipt', '{');
await sync();
assert.equal(
  (await readReceiptPaymentSync(db, 'shop', 'sale'))?.request?.status,
  'review',
);
assert.equal(
  adapter.database
    .prepare("SELECT COUNT(*) AS n FROM payments WHERE method='pix'")
    .get()!.n,
  0,
  'invalid parse never creates a Pix',
);

// A completed-looking OCR result without the reader's eligibility proof must
// not become received money or create a Pix. Reattaching it cannot double it.
seed();
const incompleteDocument = JSON.stringify({
  ...validDocument,
  automaticEligible: false,
  transactionId: null,
});
receipt('receipt', incompleteDocument, 205000);
receipt('copy', incompleteDocument, 205000);
assert.deepEqual({ ...flags() }, { received: 300000, review: 1, reading: 0 });
await sync();
assert.equal(
  adapter.database
    .prepare("SELECT COUNT(*) AS n FROM payments WHERE method='pix'")
    .get()!.n,
  0,
  'unverified copies never create automatic Pix payments',
);

// Existing direct links and explicit historical claims preserve old sales.
for (const evidence of ['link', 'claim']) {
  seed();
  receipt('receipt', incompleteDocument);
  adapter.database.exec(
    "INSERT INTO payments(id,store_id,sale_id,method,amount_cents,created_at) VALUES('legacy','shop','sale','pix',410000,1)",
  );
  if (evidence === 'link')
    adapter.database.exec(
      "INSERT INTO receipt_payment_links(attachment_id,store_id,sale_id,payment_id,transaction_id,created_at) VALUES('receipt','shop','sale','legacy','receipt:receipt',1)",
    );
  else
    adapter.database
      .prepare(
        "INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at) VALUES('claim','shop','owner','sale.receipt_transaction_claimed','attachment','receipt',?,1)",
      )
      .run(
        JSON.stringify({
          transactionId: null,
          saleId: 'sale',
          paymentIds: ['legacy'],
        }),
      );
  assert.deepEqual(
    { ...flags() },
    { received: 710000, review: 0, reading: 0 },
    `historical ${evidence} remains accepted`,
  );
  assert.equal(
    saleReceiptIncome({
      productsTotalCents: 710000,
      payments: [{ method: 'cash', amountCents: 300000 }],
      receipts: [
        {
          receiptAmountCents: 410000,
          receiptDetails: { ...validDocument, automaticEligible: false },
          receiptPaymentId: 'legacy',
        },
      ],
    }).receivedTotalCents,
    710000,
  );
}

// A bad attachment must not attach its warning to an independently valid one.
seed();
receipt();
receipt(
  'scheduled',
  JSON.stringify({ ...validDocument, state: 'scheduled', transactionId: null }),
  100000,
);
await sync();
assert.equal(
  adapter.database
    .prepare(
      "SELECT receipt_review_reason AS reason FROM attachments WHERE id='receipt'",
    )
    .get()!.reason,
  null,
);
assert.ok(
  adapter.database
    .prepare(
      "SELECT receipt_review_reason AS reason FROM attachments WHERE id='scheduled'",
    )
    .get()!.reason,
);

// An allocation warning belongs only to the previously claimed receipt.
seed();
receipt();
adapter.database.exec(
  "INSERT INTO payments(id,store_id,sale_id,method,amount_cents,created_at) VALUES('legacy','shop','sale','pix',410000,1)",
);
await sync();
receipt(
  'unaffected',
  JSON.stringify({
    ...validDocument,
    transactionId: 'E0000000000000000000000000000002',
  }),
);
adapter.database.exec("DELETE FROM payments WHERE id='legacy'");
await sync();
assert.ok(
  adapter.database
    .prepare(
      "SELECT receipt_review_reason AS reason FROM attachments WHERE id='receipt'",
    )
    .get()!.reason,
);
assert.equal(
  adapter.database
    .prepare(
      "SELECT receipt_review_reason AS reason FROM attachments WHERE id='unaffected'",
    )
    .get()!.reason,
  null,
);

// Legacy widespread warnings stop affecting live status as soon as the cause
// disappears, including manual sync (no later automatic settlement will run).
seed();
receipt();
await sync();
receipt('duplicate');
await sync();
assert.equal(flags().received, 300000);
adapter.database.exec(
  "DELETE FROM attachments WHERE id='duplicate'; UPDATE sale_receipt_payment_sync SET status='manual'",
);
assert.deepEqual({ ...flags() }, { received: 710000, review: 0, reading: 0 });
const obsoleteReason = adapter.database
  .prepare(
    "SELECT receipt_review_reason AS reason FROM attachments WHERE id='receipt'",
  )
  .get()!.reason as string;
assert.ok(
  DERIVED_RECEIPT_REVIEW_REASONS.some(
    (candidate) => candidate === obsoleteReason,
  ),
);
assert.equal(
  saleReceiptIncome({
    productsTotalCents: 710000,
    payments: [{ method: 'cash', amountCents: 300000 }],
    receipts: [
      {
        receiptAmountCents: 410000,
        receiptDetails: validDocument,
        receiptReviewReason: obsoleteReason,
      },
    ],
  }).receivedTotalCents,
  710000,
  'TS also ignores an obsolete derived warning once evidence is valid',
);
assert.equal(
  adapter.database
    .prepare(
      `SELECT ${effectiveReceiptReviewReasonSql('ar')} AS reason FROM attachments ar WHERE id='receipt'`,
    )
    .get()!.reason,
  null,
);
await db.batch([cleanupResolvedReceiptReviews(db, 'shop', 'sale')]);
assert.equal(
  adapter.database
    .prepare(
      "SELECT receipt_review_reason AS reason FROM attachments WHERE id='receipt'",
    )
    .get()!.reason,
  null,
);
assert.equal(
  (await readReceiptPaymentSync(db, 'shop', 'sale'))?.request?.status,
  'manual',
);
assert.equal(
  adapter.database
    .prepare("SELECT COUNT(*) AS n FROM payments WHERE method='pix'")
    .get()!.n,
  1,
  'cleanup never modifies payments',
);

// Durable duplicate claims still block a different attachment after deletion.
receipt('reused');
adapter.database.exec("DELETE FROM attachments WHERE id='receipt'");
await db.batch([cleanupResolvedReceiptReviews(db, 'shop', 'sale')]);
assert.equal(flags().received, 300000);
assert.equal(flags().review, 1);

// Cleanup must preserve both genuine invalid evidence and financial/manual holds.
seed();
receipt();
const manual =
  'A identificação da transação mudou na releitura. Confira o pagamento registrado.';
adapter.database
  .prepare('UPDATE attachments SET receipt_review_reason=?')
  .run(manual);
await db.batch([cleanupResolvedReceiptReviews(db, 'shop', 'sale')]);
assert.equal(
  adapter.database
    .prepare('SELECT receipt_review_reason AS reason FROM attachments')
    .get()!.reason,
  manual,
);
assert.equal(flags().review, 1);
assert.equal(flags().received, 300000);
assert.equal(
  saleReceiptIncome({
    productsTotalCents: 710000,
    payments: [{ method: 'cash', amountCents: 300000 }],
    receipts: [
      {
        receiptAmountCents: 410000,
        receiptDetails: validDocument,
        receiptReviewReason: manual,
      },
    ],
  }).receivedTotalCents,
  300000,
  'TS and SQL both exclude a genuine manual financial hold',
);
adapter.database
  .prepare(
    'UPDATE attachments SET receipt_details_json=?,receipt_review_reason=?',
  )
  .run(
    JSON.stringify({ ...validDocument, state: 'unknown' }),
    'Confira o documento: pagamento não confirmado ou leitura ambígua.',
  );
await db.batch([cleanupResolvedReceiptReviews(db, 'shop', 'sale')]);
assert.equal(
  adapter.database
    .prepare('SELECT receipt_review_reason AS reason FROM attachments')
    .get()!.reason,
  null,
  'A falta de frase de conclusão é apenas informativa quando o valor é elegível',
);

// Revision changes when a row changes beneath unchanged COUNT/MAX aggregates,
// and for audited price/cash/status changes without any OCR job transition.
seed();
receipt();
receipt('second', JSON.stringify({ ...validDocument, transactionId: null }));
adapter.database.exec(
  `INSERT INTO receipt_ocr_jobs(attachment_id,status,next_attempt_at,created_at,updated_at) VALUES('receipt','pending',1,1,10),('second','pending',1,1,20)`,
);
const activity = (store = 'shop') =>
  adapter.database.prepare(RECEIPT_ACTIVITY_SQL).get(store)!;
const signature = () => JSON.stringify(activity());
let previous = signature();
assert.equal(activity().pending, 2);
assert.equal(signature(), previous, 'unchanged polling is stable');
for (const mutation of [
  "UPDATE receipt_ocr_jobs SET updated_at=11 WHERE attachment_id='receipt'",
  "UPDATE receipt_ocr_jobs SET reader_revision=2 WHERE attachment_id='receipt'",
  "UPDATE receipt_ocr_jobs SET status='retry',attempts=1,error_code='OCR_RETRY' WHERE attachment_id='receipt'",
  "UPDATE receipt_ocr_jobs SET status='pending' WHERE attachment_id='receipt'; UPDATE receipt_ocr_jobs SET status='retry' WHERE attachment_id='second'",
]) {
  adapter.database.exec(mutation);
  assert.notEqual(signature(), previous, mutation);
  previous = signature();
}
for (const [index, action] of [
  'sale.prices_updated',
  'sale.payment_added',
  'sale.order_status_changed',
  'sale.receipt_deleted',
].entries()) {
  adapter.database
    .prepare(
      `INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,'shop','owner',?,'sale','sale','{}',50)`,
    )
    .run(`event-${index}`, action);
  assert.notEqual(signature(), previous, `${action} in the same millisecond`);
  previous = signature();
}
adapter.database.exec(
  "INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at) VALUES('foreign','other','owner','sale.updated','sale','foreign','{}',99)",
);
assert.equal(
  signature(),
  previous,
  'foreign store changes do not invalidate this store',
);
await db.batch(requestReceiptPaymentSync(db, scope, 'one', 50));
previous = signature();
await db.batch(requestReceiptPaymentSync(db, scope, 'two', 50));
assert.notEqual(
  signature(),
  previous,
  'same-status, same-time replacement sync intent',
);
assert.equal(activity().pending, 3);
assert.equal(activity('other').pending, 0);
adapter.close();
console.log(
  'PASS: invalid-document TS/SQL parity including pending rereads, fail-closed sync, scoped review propagation/cleanup, durable duplicate/manual safety, and deterministic store activity revision.',
);
