import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import { parseReceiptDocument } from '../lib/receipt-document.ts';
import { saleReceiptIncome } from '../lib/receipt-income.ts';
import {
  deriveReceiptReconciliation,
  paymentMethodTotals,
} from '../lib/receipt-reconciliation.ts';
import {
  duplicateReceiptSql,
  effectiveReceiptReviewReasonSql,
  linkedReceiptPaymentSql,
  SALE_RECEIVED_TOTAL_SQL,
} from '../lib/server/sale-status-sql.ts';
import { readOverview } from '../lib/server/overview.ts';
import { overviewSaleComparison } from '../lib/overview.ts';
import { deleteSaleReceipt } from '../lib/server/delete-receipt.ts';
import {
  requestReceiptPaymentSync,
  settleReceiptPaymentSync,
} from '../lib/server/receipt-payment-sync.ts';

// Execute the real API hydration and display function while isolating routing,
// authentication and browser dependencies. SQL still runs against full schema.
function functionsFrom(file, names, globals) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const functions = names
    .map((name) => {
      const node = source.statements.find(
        (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
      );
      assert.ok(node, `${file}: ${name}`);
      return node.getText(source);
    })
    .join('\n');
  const output = ts.transpileModule(functions, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  return runInNewContext(`${output}\n({${names.join(',')}})`, {
    exports: {},
    require: () => ({ jsx, jsxs, Fragment }),
    ...globals,
  });
}
const { hydrateSales } = functionsFrom(
  'app/api/sales/route.ts',
  ['hydrateSales', 'attachmentRecord', 'resultRows'],
  {
    parseReceiptDocument,
    saleReceiptIncome,
    deriveReceiptReconciliation,
    paymentMethodTotals,
    duplicateReceiptSql,
    effectiveReceiptReviewReasonSql,
    linkedReceiptPaymentSql,
  },
);
const { SaleComparison } = functionsFrom(
  'components/pdv/views/overview-production-view.tsx',
  ['SaleComparison'],
  {
    overviewSaleComparison,
    money: (cents) => `BRL ${cents / 100}`,
    cn: (...values) => values.filter(Boolean).join(' '),
    TriangleAlert: () => null,
    Check: () => null,
    FileText: () => null,
  },
);
const db = new SqliteDatabase(':memory:');
for (const file of readdirSync('drizzle')
  .filter((name) => /^\d+_.*\.sql$/.test(name))
  .sort())
  db.database.exec(readFileSync(`drizzle/${file}`, 'utf8'));
db.database.exec(`
  INSERT INTO stores(id,name,code,created_at,updated_at) VALUES('shop','Test','TEST',1,1);
  INSERT INTO users(id,store_id,role,auth_kind,display_name,created_at,updated_at) VALUES('owner','shop','owner','password','Test',1,1);
  INSERT INTO sales(id,store_id,number,customer_name,seller_user_id,seller_name,products_total_cents,received_total_cents,received_difference_cents,reference_total_cents,price_difference_cents,created_at)
    VALUES('sale','shop',1,'Test','owner','Test',710000,300000,-410000,710000,0,1);
  INSERT INTO payments(id,store_id,sale_id,method,amount_cents,created_at) VALUES('cash','shop','sale','cash',300000,1);
`);
const document = {
  version: 1,
  state: 'completed',
  automaticEligible: true,
  blocked: false,
  ambiguous: false,
  payerName: null,
  payerBank: null,
  recipientName: null,
  recipientBank: null,
  recipientDocument: '12345678000199',
  transactionId: 'E0000000000000000000000000000001',
  paidAtText: null,
};
function receipt(id, details, amount = 410000) {
  db.database
    .prepare(`INSERT INTO attachments(id,store_id,kind,sale_id,r2_key,file_name,mime_type,size_bytes,receipt_amount_cents,receipt_amount_source,receipt_amount_confirmed_at,receipt_details_json,created_by,created_at)
    VALUES(?,'shop','receipt','sale',?,?,'image/png',4,?,'ocr',1,?,'owner',1)`)
    .run(id, id, id, amount, details);
}
const overview = (filter = 'all') =>
  readOverview(
    db,
    new URL(`https://test/overview?period=all&comparison=${filter}`),
    'shop',
  );
async function sale() {
  const listed = db.database
    .prepare(
      `SELECT id,status,number,products_total_cents AS productsTotalCents,received_total_cents AS receivedTotalCents,reference_total_cents AS referenceTotalCents,price_difference_cents AS priceDifferenceCents,created_at AS createdAt,cancelled_at AS cancelledAt FROM sales`,
    )
    .all();
  return (await hydrateSales(db, 'shop', listed))[0];
}
for (const raw of [
  null,
  '{',
  '{}',
  'null',
  JSON.stringify({ version: 1, state: 'completed' }),
  JSON.stringify(document),
  JSON.stringify({ ...document, state: 'unknown' }),
]) {
  receipt('receipt', raw);
  const hydrated = await sale();
  const sql = db.database
    .prepare(`SELECT ${SALE_RECEIVED_TOTAL_SQL} AS received FROM sales s`)
    .get();
  assert.equal(
    hydrated.receivedTotalCents,
    sql.received,
    'actual sales serialization and SQL income agree',
  );
  assert.equal(
    (await overview()).items[0].receivedCents,
    sql.received,
    'overview agrees',
  );
  if (raw !== null && !parseReceiptDocument(raw)) {
    assert.equal(hydrated.receipts[0].receiptDetails?.blocked, true);
    assert.equal(hydrated.reconciliation.status, 'pending');
    assert.equal(hydrated.reconciliation.confirmedTotalCents, 0);
    assert.equal((await overview()).items[0].receiptReviewCount, 1);
    assert.ok((await overview()).items[0].receipts[0].receiptReviewReason);
  }
  if (raw === JSON.stringify(document))
    assert.equal(
      hydrated.receipts[0].receiptDetails.recipientDocument,
      '***0199',
      'document remains masked',
    );
  db.database.exec("DELETE FROM attachments WHERE id='receipt'");
}

receipt('receipt', JSON.stringify(document));
const staleReason =
  'Há comprovantes da mesma transação. Não registre o Pix duas vezes.';
db.database
  .prepare('UPDATE attachments SET receipt_review_reason=?')
  .run(staleReason);
assert.equal((await sale()).receipts[0].receiptReviewReason, null);
assert.equal((await overview()).items[0].receiptReviewCount, 0);
assert.equal((await overview()).items[0].receipts[0].receiptReviewReason, null);
assert.equal(
  (await overview('matched')).totals.saleCount,
  0,
  'missing product price still prevents reconciliation',
);
assert.equal(
  db.database
    .prepare('SELECT receipt_review_reason AS reason FROM attachments')
    .get().reason,
  staleReason,
  'GET hydration never mutates stored evidence',
);

const scope = {
  storeId: 'shop',
  saleId: 'sale',
  actorId: 'owner',
  subject: { role: 'owner' },
};
async function sync() {
  await db.batch(
    requestReceiptPaymentSync(db, scope, crypto.randomUUID(), Date.now()),
  );
  await settleReceiptPaymentSync(db, 'shop', 'sale');
}
await sync();
receipt('duplicate', JSON.stringify(document));
await sync();
assert.equal((await sale()).receivedTotalCents, 300000);
assert.equal((await overview()).items[0].receiptReviewCount, 2);
assert.match(
  (await overview()).items[0].receipts[0].receiptReviewReason,
  /^Transação repetida/,
);
const paymentsBefore = JSON.stringify(
  db.database.prepare('SELECT * FROM payments ORDER BY id').all(),
);
await deleteSaleReceipt(
  db,
  { delete: async () => {} },
  { ...scope, receiptId: 'duplicate', operationId: crypto.randomUUID() },
);
assert.equal(
  db.database
    .prepare(
      "SELECT receipt_review_reason AS reason FROM attachments WHERE id='receipt'",
    )
    .get().reason,
  null,
  'delete clears resolved warning in the transaction',
);
assert.equal(
  db.database.prepare('SELECT status FROM sale_receipt_payment_sync').get()
    .status,
  'manual',
);
assert.equal(
  JSON.stringify(
    db.database.prepare('SELECT * FROM payments ORDER BY id').all(),
  ),
  paymentsBefore,
);
assert.equal((await sale()).receivedTotalCents, 710000);
assert.equal((await overview()).items[0].receiptReviewCount, 0);

db.database.exec("DELETE FROM payments WHERE method='cash'");
const partial = (await overview()).items[0];
assert.equal(partial.receiptCents, 410000);
assert.equal(
  partial.pixCents,
  710000,
  'expected balance stays independent from Pix received',
);
const markup = renderToStaticMarkup(
  jsx(SaleComparison, { sale: { ...partial, saleInvalid: 0 } }),
);
assert.match(markup, /Pix recebido BRL 4100/);
assert.doesNotMatch(markup, /Pix recebido BRL 7100|Pix informado/);
assert.match(markup, /BRL 3000.*abaixo.*saldo.*esperado/s);
db.close();
console.log(
  'PASS: actual sales hydration, overview aggregate/attachment warnings, atomic deletion cleanup, masked details, fail-closed reconciliation, and rendered Pix received versus expected balance.',
);
