import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import {
  legacyReceiptReviewStatus,
  queueLegacyReceiptReviews,
} from '../lib/server/legacy-receipt-review.ts';
import { extractReceiptDocument } from '../lib/receipt-document.ts';
import { receiptDrivenPayments } from '../lib/receipt-income.ts';

const adapter = new SqliteDatabase(':memory:');
const db = adapter as unknown as D1Database;
for (const file of readdirSync('drizzle')
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort())
  adapter.database.exec(readFileSync(`drizzle/${file}`, 'utf8'));
adapter.database
  .exec(`INSERT INTO stores(id,name,code,created_at,updated_at) VALUES('shop','Teste','TEST',1,1),('other','Outra','OTHER',1,1);
  INSERT INTO users(id,store_id,role,auth_kind,display_name,created_at,updated_at) VALUES('owner','shop','owner','password','Teste',1,1);`);
let number = 0;
function sale(id: string, store = 'shop', status = 'completed') {
  adapter.database
    .prepare(`INSERT INTO sales(id,store_id,number,customer_name,seller_user_id,seller_name,products_total_cents,received_total_cents,received_difference_cents,reference_total_cents,price_difference_cents,created_at,status)
    VALUES(?,?,?,'Cliente','owner','Teste',710000,710000,0,710000,0,1,?)`)
    .run(id, store, ++number, status);
  adapter.database
    .prepare(
      `INSERT INTO payments(id,store_id,sale_id,method,account_name,amount_cents,created_at) VALUES(?,?,?,'pix','Conta antiga digitada',710000,1)`,
    )
    .run(`p-${id}`, store, id);
}
function receipt(id: string, saleId: string, source = 'ocr', store = 'shop') {
  adapter.database
    .prepare(`INSERT INTO attachments(id,store_id,kind,sale_id,r2_key,file_name,mime_type,size_bytes,receipt_amount_cents,receipt_amount_source,receipt_amount_confirmed_at,receipt_details_json,created_by,created_at)
    VALUES(?,?,'receipt',?,?,?,'image/png',4,100000,?,1,'{"original":true}','owner',1)`)
    .run(id, store, saleId, id, id, source);
}
const scope = {
  storeId: 'shop',
  actorId: 'owner',
  subject: { role: 'owner' as const },
};
sale('legacy');
receipt('r1', 'legacy');
receipt('r2', 'legacy');
receipt('corrected', 'legacy', 'manual');
adapter.database
  .exec(`INSERT INTO payments(id,store_id,sale_id,method,amount_cents,created_at) VALUES('cash','shop','legacy','cash',300000,1);
 INSERT INTO receipt_ocr_jobs(attachment_id,status,attempts,generation,next_attempt_at,created_at,updated_at) VALUES('r1','done',1,2,1,1,1);`);
sale('foreign', 'other');
receipt('foreign-r', 'foreign', 'ocr', 'other');
sale('cancelled', 'shop', 'cancelled');
receipt('cancelled-r', 'cancelled');
sale('active');
receipt('active-r', 'active');
adapter.database.exec(
  `INSERT INTO receipt_ocr_jobs(attachment_id,status,attempts,generation,next_attempt_at,created_at,updated_at) VALUES('active-r','processing',1,1,1,1,1);`,
);
sale('missing');
sale('automatic');
receipt('auto-r', 'automatic');
adapter.database.exec(
  `INSERT INTO receipt_payment_links(attachment_id,store_id,sale_id,payment_id,transaction_id,created_at) VALUES('auto-r','shop','automatic','p-automatic','E1111111111111111111111111111111',1);`,
);
const beforePayments = JSON.stringify(
  adapter.database.prepare('SELECT * FROM payments ORDER BY id').all(),
);
assert.deepEqual(await legacyReceiptReviewStatus(db, scope), {
  eligibleSales: 1,
  reviewedSales: 0,
  readingSales: 1,
  missingReceiptSales: 1,
  manualReceiptSales: 1,
});
assert.deepEqual(await queueLegacyReceiptReviews(db, scope, 20), {
  queuedSales: 1,
  queuedReceipts: 2,
  conflicts: 0,
});
assert.equal(
  JSON.stringify(
    adapter.database.prepare('SELECT * FROM payments ORDER BY id').all(),
  ),
  beforePayments,
);
assert.equal(
  adapter.database
    .prepare(
      "SELECT receipt_amount_cents AS amount FROM attachments WHERE id='r1'",
    )
    .get()!.amount,
  null,
);
assert.equal(
  adapter.database
    .prepare("SELECT generation FROM receipt_ocr_jobs WHERE attachment_id='r1'")
    .get()!.generation,
  3,
);
assert.equal(
  adapter.database
    .prepare(
      "SELECT COUNT(*) AS n FROM receipt_ocr_jobs WHERE attachment_id IN ('r1','r2') AND status='pending'",
    )
    .get()!.n,
  2,
);
assert.equal(
  adapter.database
    .prepare(
      "SELECT receipt_amount_cents AS amount FROM attachments WHERE id='corrected'",
    )
    .get()!.amount,
  100000,
);
for (const id of ['foreign-r', 'cancelled-r', 'auto-r', 'active-r'])
  assert.equal(
    adapter.database
      .prepare(
        'SELECT receipt_amount_cents AS amount FROM attachments WHERE id=?',
      )
      .get(id)!.amount,
    100000,
  );
const audit = JSON.parse(
  adapter.database
    .prepare(
      "SELECT details_json AS details FROM audit_events WHERE action='sale.legacy_receipts_reread'",
    )
    .get()!.details as string,
);
assert.equal(audit.receipts[0].amount, 100000);
assert.equal(audit.receipts[0].details, '{"original":true}');
assert.deepEqual(audit.rereadIds, ['r1', 'r2']);
assert.deepEqual(await queueLegacyReceiptReviews(db, scope, 21), {
  queuedSales: 0,
  queuedReceipts: 0,
  conflicts: 0,
});
adapter.database.exec(
  "UPDATE receipt_ocr_jobs SET status='done' WHERE attachment_id IN ('r1','r2'); UPDATE attachments SET receipt_amount_cents=90000,receipt_amount_source='ocr' WHERE id IN ('r1','r2')",
);
assert.equal(
  (await queueLegacyReceiptReviews(db, scope, 22)).queuedSales,
  0,
  'Replay must not erase new readings',
);
await assert.rejects(
  queueLegacyReceiptReviews(
    db,
    {
      ...scope,
      subject: { role: 'operator', permissions: ['sales', 'sales.receipts'] },
    },
    23,
  ),
  /administrador/,
);

// A concurrent manual correction invalidates the snapshot before any reset.
sale('race');
receipt('race-r', 'race');
const racing = {
  prepare: db.prepare.bind(db),
  batch: async (queries: D1PreparedStatement[]) => {
    adapter.database.exec(
      "UPDATE attachments SET receipt_amount_cents=99999,receipt_amount_source='manual' WHERE id='race-r'",
    );
    return db.batch(queries);
  },
} as D1Database;
assert.deepEqual(await queueLegacyReceiptReviews(racing, scope, 24), {
  queuedSales: 0,
  queuedReceipts: 0,
  conflicts: 1,
});
assert.equal(
  adapter.database
    .prepare(
      "SELECT receipt_amount_cents AS amount FROM attachments WHERE id='race-r'",
    )
    .get()!.amount,
  99999,
);
assert.equal(
  adapter.database
    .prepare(
      "SELECT COUNT(*) AS n FROM receipt_ocr_jobs WHERE attachment_id='race-r'",
    )
    .get()!.n,
  0,
);

// If a later statement fails, neither sibling is cleared and no audit is saved.
sale('rollback');
receipt('rollback-a', 'rollback');
receipt('rollback-b', 'rollback');
adapter.database.exec(
  "CREATE TRIGGER fail_test_queue BEFORE INSERT ON receipt_ocr_jobs WHEN NEW.attachment_id='rollback-b' BEGIN SELECT RAISE(ABORT,'synthetic queue failure'); END;",
);
await assert.rejects(
  queueLegacyReceiptReviews(db, scope, 25),
  /synthetic queue failure/,
);
assert.equal(
  adapter.database
    .prepare(
      "SELECT COUNT(*) AS n FROM attachments WHERE sale_id='rollback' AND receipt_amount_cents=100000",
    )
    .get()!.n,
  2,
);
assert.equal(
  adapter.database
    .prepare(
      "SELECT COUNT(*) AS n FROM audit_events WHERE entity_id='rollback'",
    )
    .get()!.n,
  0,
);
adapter.database.exec('DROP TRIGGER fail_test_queue');
assert.equal(
  (await queueLegacyReceiptReviews(db, scope, 26)).queuedReceipts,
  2,
);
assert.equal(
  JSON.stringify(
    adapter.database
      .prepare(
        "SELECT * FROM payments WHERE sale_id NOT IN ('race','rollback') ORDER BY id",
      )
      .all(),
  ),
  beforePayments,
);

// Display name is separate from account/bank identity used by existing summaries.
const details = extractReceiptDocument(
  'Comprovante Pix\nR$ 15.000\nDestino\nNome: Dias Imoveis\nBanco: MT INSTITUICAO DE PAGAMENTO SA',
).details;
const payments = [
  {
    id: 'p',
    method: 'pix' as const,
    amountCents: 7,
    pixAccountId: 'account',
    accountName: 'Conta antiga',
  },
  {
    id: 'cash',
    method: 'cash' as const,
    amountCents: 300000,
    pixAccountId: null,
    accountName: null,
  },
];
const receiptRows = [
  {
    id: 'r',
    receiptAmountCents: 1500000,
    receiptPaymentId: 'p',
    receiptDetails: details,
  },
];
const rows = receiptDrivenPayments({ payments, receipts: receiptRows });
assert.equal(rows[0].recipientName, 'Dias Imoveis');
assert.equal(rows[0].accountName, 'MT INSTITUICAO DE PAGAMENTO SA');
assert.equal(rows[0].pixAccountId, 'account');
assert.equal(rows[0].amountCents, 1500000);
assert.equal(rows[1].amountCents, 300000);
assert.equal(
  receiptDrivenPayments({
    payments,
    receipts: [
      {
        ...receiptRows[0],
        receiptDetails: { ...details, recipientName: null },
      },
    ],
  })[0].recipientName,
  null,
);
adapter.close();
console.log(
  'Legacy reread: permissions, tenant scope, replay, manual corrections, atomic rollback and untouched history passed. Pix display name preserves accounting identity.',
);
