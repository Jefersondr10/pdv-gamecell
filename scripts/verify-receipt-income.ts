import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import {
  extractReceiptDocument,
  parseReceiptDocument,
  shortReceiptDate,
} from '../lib/receipt-document.ts';
import {
  readReceiptPaymentSync,
  requestReceiptPaymentSync,
  settleReceiptPaymentSync,
} from '../lib/server/receipt-payment-sync.ts';
import { saleReceiptIncome } from '../lib/receipt-income.ts';
import {
  SALE_RECEIVED_TOTAL_SQL,
  SALE_ISSUE_SQL,
  duplicateReceiptSql,
} from '../lib/server/sale-status-sql.ts';
import { readOverview } from '../lib/server/overview.ts';
const text = (
  n = 1,
  bank = 'Banco Recebedor',
  document = '12345678000199',
  amount = '4.100,00',
) =>
  `Comprovante de Pix\n09/09/2026 às 17:34:00\nR$ ${amount}\nOrigem e destino\nPagador de teste\nMercado Pago\nCNPJ: 00000000000000\nLoja de teste\n${bank}\nCNPJ: ${document}\nID de transação Pix\nE${String(n).padStart(31, '0')}`;

let adapter = new SqliteDatabase(':memory:');
let db = adapter as unknown as D1Database;
const scope = {
  storeId: 'shop',
  saleId: 'sale',
  actorId: 'owner',
  subject: { role: 'owner' as const },
};
function seed(cash = 300000, total = 710000) {
  adapter?.close();
  adapter = new SqliteDatabase(':memory:');
  db = adapter as unknown as D1Database;
  for (const file of readdirSync('drizzle')
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort())
    adapter.database.exec(readFileSync(`drizzle/${file}`, 'utf8'));
  adapter.database
    .exec(`INSERT INTO stores(id,name,code,created_at,updated_at) VALUES('shop','Teste','TEST',1,1),('other','Outra','OTHER',1,1);
  INSERT INTO users(id,store_id,role,auth_kind,display_name,created_at,updated_at) VALUES('owner','shop','owner','password','Teste',1,1);
  INSERT INTO pix_accounts(id,store_id,name,receipt_bank,receipt_recipient_document,created_by,created_at,updated_at) VALUES('bank','shop','Conta teste','Banco Recebedor','12345678000199','owner',1,1),('bank2','shop','Conta dois','Banco Dois','98765432000100','owner',1,1);
  INSERT INTO sales(id,store_id,number,customer_name,seller_user_id,seller_name,products_total_cents,received_total_cents,received_difference_cents,reference_total_cents,price_difference_cents,created_at) VALUES('sale','shop',1,'Cliente teste','owner','Teste',${total},${cash},${cash - total},${total},0,1);`);
  if (cash)
    adapter.database
      .prepare(
        "INSERT INTO payments(id,store_id,sale_id,method,amount_cents,created_at) VALUES('cash','shop','sale','cash',?,1)",
      )
      .run(cash);
}
function addReceipt(
  id = 'r1',
  n = 1,
  bank = 'Banco Recebedor',
  doc = '12345678000199',
  amount = '4.100,00',
) {
  const result = extractReceiptDocument(text(n, bank, doc, amount));
  adapter.database
    .prepare(
      `INSERT INTO attachments(id,store_id,kind,sale_id,r2_key,file_name,mime_type,size_bytes,receipt_amount_cents,receipt_amount_source,receipt_amount_confirmed_at,receipt_details_json,created_by,created_at) VALUES(?,'shop','receipt','sale',?,?,'image/png',4,?,'ocr',1,?,'owner',1)`,
    )
    .run(id, id, id, result.amountCents, JSON.stringify(result.details));
  return result;
}
const state = () => readReceiptPaymentSync(db, 'shop', 'sale');
const sync = async () => {
  await adapter.batch(
    requestReceiptPaymentSync(db, scope, crypto.randomUUID(), Date.now()),
  );
  await settleReceiptPaymentSync(db, 'shop', 'sale');
};

async function income(expected: number) {
  const current = (await state())!;
  const receipts = adapter.database
    .prepare(
      `SELECT id, receipt_amount_cents AS receiptAmountCents, receipt_details_json AS details, CASE WHEN ${duplicateReceiptSql('attachments')} THEN 'Transação repetida em outro comprovante.' ELSE receipt_review_reason END AS receiptReviewReason FROM attachments WHERE sale_id='sale' AND kind='receipt'`,
    )
    .all()
    .map((r) => ({
      ...r,
      receiptAmountCents: r.receiptAmountCents as number | null,
      receiptDetails: parseReceiptDocument(r.details),
    }));
  const actual = saleReceiptIncome({
    productsTotalCents: current.sale.productsTotalCents,
    payments: current.payments,
    receipts,
  });
  assert.equal(actual.receivedTotalCents, expected, 'receipt + cash amount');
  const sql = adapter.database
    .prepare(
      `SELECT ${SALE_RECEIVED_TOTAL_SQL} AS received, ${SALE_ISSUE_SQL.pending_payment} AS pending, ${SALE_ISSUE_SQL.overpaid} AS overpaid FROM sales s WHERE id='sale'`,
    )
    .get()!;
  assert.equal(sql.received, expected, 'SQL and client agree');
  assert.equal(sql.pending, Number(expected < current.sale.productsTotalCents));
  assert.equal(
    sql.overpaid,
    Number(expected > current.sale.productsTotalCents),
  );
  const overview = await readOverview(
    db,
    new URL('https://fixture.test?period=all'),
    'shop',
  );
  assert.equal(
    overview.items.find((x) => x.id === 'sale')?.receivedCents,
    expected,
    'overview agrees',
  );
}
seed(0);
await income(0);
seed();
await income(300000);
addReceipt();
await income(710000);
await sync();
await income(710000);
assert.equal((await state())!.request?.status, 'applied');
assert.equal(
  (await state())!.payments.filter((p) => p.method === 'pix').length,
  1,
);
await sync();
await income(710000);
adapter.database.exec(
  "UPDATE attachments SET receipt_amount_cents=NULL WHERE id='r1'",
);
await income(300000);
adapter.database.exec(
  "UPDATE attachments SET receipt_amount_cents=402000 WHERE id='r1'",
);
await sync();
await income(702000);
adapter.database.exec('UPDATE sales SET products_total_cents=702000');
await income(702000);
adapter.database.exec("DELETE FROM attachments WHERE id='r1'");
await income(300000);
seed(0);
addReceipt('r1', 1, 'Banco não cadastrado', '12345678000199', '7.020,00');
adapter.database.exec(
  "INSERT INTO payments(id,store_id,sale_id,method,amount_cents,created_at) VALUES('old','shop','sale','pix',710000,1); UPDATE sales SET received_total_cents=710000",
);
await sync();
await income(702000);
assert.equal(
  (await state())!.request?.status,
  'applied',
  'legacy account cannot block receipt income',
);
seed(0);
addReceipt('r1', 1, 'Outro Banco', '12345678000199', '7.100,00');
await sync();
await income(710000);
assert.equal(
  (await state())!.payments[0].pixAccountId,
  null,
  'unknown bank does not require manual selection',
);
seed();
addReceipt();
await sync();
addReceipt('duplicate');
await income(300000);
await sync();
await income(300000);
adapter.database.exec("DELETE FROM attachments WHERE id='duplicate'");
await income(710000);
seed();
addReceipt();
adapter.database.exec(
  "UPDATE attachments SET receipt_details_json=json_set(receipt_details_json,'$.state','scheduled')",
);
await income(300000);
await sync();
await income(300000);
seed();
addReceipt();
addReceipt('r2', 2, 'Banco Recebedor', '12345678000199', '1.000,00');
adapter.database.exec(
  "UPDATE attachments SET receipt_details_json=json_set(receipt_details_json,'$.state','scheduled') WHERE id='r2'",
);
await sync();
await income(710000);
assert.equal(
  shortReceiptDate('8/setembro/2026 às 17:51:29.'),
  '08/09/2026 · 17:51',
);
assert.equal(shortReceiptDate('10/09/2026 9:04:00'), '10/09/2026 · 09:04');
adapter.close();
console.log(
  'PASS: receipt income + cash, zero/partial sale, legacy Pix ignored, automatic bank fallback, rereading/deletion, direct price comparison, duplicate safety before sync, review preserving valid receipts, SQL/overview parity and short date.',
);
