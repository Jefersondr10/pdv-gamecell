import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import {
  extractReceiptDocument,
  preferReceiptReading,
} from '../lib/receipt-document.ts';
import { processReceiptJob } from '../lib/server/node/receipt-jobs.mjs';
import { retryReceipt } from '../lib/server/retry-receipt.ts';
import {
  readReceiptPaymentSync,
  registerFirstReceiptPix,
  requestReceiptPaymentSync,
  settleReceiptPaymentSync,
  stopReceiptPaymentSync,
  processReceiptPaymentSync,
} from '../lib/server/receipt-payment-sync.ts';
import { receiptEvidenceProblem } from '../lib/server/receipt-evidence-safety.ts';
import { readOverview } from '../lib/server/overview.ts';
import { overviewComparison, overviewSaleComparison } from '../lib/overview.ts';
import { originalSalePayments } from '../lib/server/original-sale-payments.ts';

const text = (
  n = 1,
  bank = 'Banco Recebedor',
  document = '12345678000199',
  amount = '4.100,00',
) =>
  `Comprovante de Pix\n09/09/2026 às 17:34:00\nR$ ${amount}\nOrigem e destino\nPagador de teste\nMercado Pago\nCNPJ: 00000000000000\nLoja de teste\n${bank}\nCNPJ: ${document}\nID de transação Pix\nE${String(n).padStart(31, '0')}`;
const document = extractReceiptDocument(text());
assert.equal(document.amountCents, 410000);
assert.equal(document.details.recipientBank, 'Banco Recebedor');
assert.equal(document.details.payerBank, 'Mercado Pago');
assert.equal(document.details.recipientDocument, '12345678000199');
assert.equal(document.details.automaticEligible, true);
assert.equal(
  extractReceiptDocument(text(1, undefined, undefined, '19.650')).amountCents,
  1965000,
);
assert.equal(
  extractReceiptDocument(text(1, undefined, undefined, '15.000')).amountCents,
  1500000,
);
for (const negative of [
  'Agendado',
  'Cancelado',
  'Pendente',
  'Em processamento',
  'Falha',
  'Transferência não realizada',
])
  assert.equal(
    extractReceiptDocument(`${text()}\n${negative}`).details.automaticEligible,
    false,
    negative,
  );
assert.equal(
  extractReceiptDocument(text() + '\n' + text(2)).details.automaticEligible,
  false,
);
assert.equal(
  extractReceiptDocument(
    text().replace('Origem e destino', 'R$ 8.000,00\nOrigem e destino'),
  ).details.automaticEligible,
  false,
);
const reversed = extractReceiptDocument(
  `Comprovante Pix\nR$ 4.100,00\nDestino\nLoja de teste\nOrigem\nPagador de teste\nBanco Recebedor\nCNPJ:12345678000199\nID de transação Pix\nE${'1'.repeat(31)}`,
);
assert.equal(reversed.details.recipientDocument, null);
assert.equal(reversed.details.recipientBank, null);
assert.equal(
  preferReceiptReading([
    extractReceiptDocument(text()),
    extractReceiptDocument(text(2)),
  ]).details.automaticEligible,
  false,
);
assert.equal(
  preferReceiptReading([
    extractReceiptDocument(text() + '\nPendente'),
    extractReceiptDocument(text()),
  ]).details.automaticEligible,
  false,
);
assert.equal(
  preferReceiptReading([
    extractReceiptDocument(''),
    extractReceiptDocument(text()),
  ]).details.automaticEligible,
  true,
);

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
const check = async (received: number, count: number) => {
  const s = (await state())!;
  assert.equal(s.sale.receivedTotalCents, received);
  assert.equal(s.payments.length, count);
  assert.equal(
    s.payments.reduce((sum, p) => sum + p.amountCents, 0),
    received,
  );
  return s;
};

seed(0);
await check(0, 0);
addReceipt();
await sync();
await check(410000, 1);
seed();
await check(300000, 1);
addReceipt();
await sync();
let s = await check(710000, 2);
assert.equal(s.request?.status, 'applied');
assert.deepEqual(
  (await originalSalePayments(db, 'shop', 'sale')).results.map((r) => ({
    ...r,
  })),
  [{ method: 'cash', pixAccountId: null, amountCents: 300000 }],
);
await settleReceiptPaymentSync(db, 'shop', 'sale');
await check(710000, 2);
// Explicit reread updates the SAME Pix and never changes cash. Replayed request is inert.
const retry = {
  attachmentId: 'r1',
  operationId: crypto.randomUUID(),
  expectedAmount: 410000,
  expectedConfirmedAt: 1,
  expectedGeneration: null,
};
await retryReceipt(db, scope, retry, 10);
assert.equal((await state())!.complete, false);
const originalFetch = globalThis.fetch;
globalThis.fetch = async () =>
  Response.json(
    extractReceiptDocument(text(1, undefined, undefined, '4.000,00')),
  );
await processReceiptJob(
  adapter,
  { get: async () => ({ body: new Blob(['test']).stream() }) },
  'http://fixture.test',
  () => 20,
);
await settleReceiptPaymentSync(db, 'shop', 'sale');
s = await check(700000, 2);
assert.equal(s.cashCents, 300000);
await retryReceipt(db, scope, retry, 30);
assert.equal((await state())!.complete, true);
await check(700000, 2);
// Explicit manual payment always wins over late settlement.
await adapter.batch([stopReceiptPaymentSync(db, 'shop', 'sale', 40)]);
adapter.database.exec(
  "UPDATE payments SET amount_cents=420000 WHERE method='pix'; UPDATE sales SET received_total_cents=720000,received_difference_cents=10000",
);
await settleReceiptPaymentSync(db, 'shop', 'sale');
await check(720000, 2);
// A linked Pix changed into cash cannot be counted once as cash and again as Pix.
adapter.database.exec(
  "UPDATE payments SET method='cash',pix_account_id=NULL WHERE method='pix'",
);
await sync();
s = await check(720000, 2);
assert.equal(s.request?.status, 'review');
seed(300000, 960000);
addReceipt();
await sync();
addReceipt('r2', 2, 'Banco Dois', '98765432000100', '2.500,00');
await sync();
await check(960000, 3);
assert.equal(
  (await state())!.payments.filter((p) => p.method === 'pix').length,
  2,
);
// Duplicates (even on another sale) never create a second automatic Pix.
addReceipt('duplicate', 1);
await sync();
s = await check(960000, 3);
assert.equal(s.request?.status, 'review');
seed();
addReceipt();
await sync();
adapter.database.exec("DELETE FROM attachments WHERE id='r1'");
addReceipt('replacement', 1);
await sync();
s = await check(710000, 2);
assert.equal(s.request?.status, 'review');
assert.match(
  (await receiptEvidenceProblem(
    db,
    'shop',
    'sale',
    (await state())!.receipts,
  ))!,
  /transa|comprovante/i,
);
seed();
addReceipt();
await sync();
adapter.database.exec(
  "INSERT INTO sales(id,store_id,number,customer_name,seller_user_id,seller_name,products_total_cents,received_total_cents,received_difference_cents,reference_total_cents,price_difference_cents,created_at) VALUES('second','shop',2,'Segundo','owner','Teste',410000,0,-410000,410000,0,1)",
);
addReceipt('other-proof');
adapter.database.exec(
  "UPDATE attachments SET sale_id='second' WHERE id='other-proof'",
);
await adapter.batch(
  requestReceiptPaymentSync(
    db,
    { ...scope, saleId: 'second' },
    'duplicate-other-sale',
    1,
  ),
);
await settleReceiptPaymentSync(db, 'shop', 'second');
assert.equal(
  (await readReceiptPaymentSync(db, 'shop', 'second'))!.sale.receivedTotalCents,
  0,
);
assert.equal(
  (await readReceiptPaymentSync(db, 'shop', 'second'))!.request?.status,
  'review',
);
// A terminal unreadable receipt leaves review, not an endless pending sync.
seed();
addReceipt();
adapter.database.exec(
  "UPDATE attachments SET receipt_amount_cents=NULL; INSERT INTO receipt_ocr_jobs(attachment_id,status,next_attempt_at,created_at,updated_at) VALUES('r1','needs_review',1,1,1)",
);
await adapter.batch(
  requestReceiptPaymentSync(db, scope, 'terminal-read', Date.now()),
);
await processReceiptPaymentSync(db);
assert.equal((await state())!.request?.status, 'review');
adapter.database.exec(
  "UPDATE sale_receipt_payment_sync SET status='pending'; UPDATE receipt_ocr_jobs SET status='processing'",
);
await processReceiptPaymentSync(db);
assert.equal((await state())!.request?.status, 'pending');
// Bank registration is optional: unidentified/inactive registry uses receipt bank.
for (const mutation of [
  'UPDATE pix_accounts SET active=0',
  "UPDATE pix_accounts SET receipt_bank='Outro banco'",
]) {
  seed();
  addReceipt();
  adapter.database.exec(mutation);
  await sync();
  await check(710000, 2);
}
// Upgrading this receipt's provisional identity must keep its payment, not duplicate it.
seed();
addReceipt();
adapter.database.exec('UPDATE attachments SET receipt_details_json=NULL');
await sync();
const provisional = (await state())!.payments.find(
  (p) => p.method === 'pix',
)!.id;
adapter.database
  .prepare('UPDATE attachments SET receipt_details_json=?')
  .run(JSON.stringify(document.details));
await sync();
await check(710000, 2);
assert.equal(
  (await state())!.payments.find((p) => p.method === 'pix')!.id,
  provisional,
);
assert.equal(
  adapter.database
    .prepare('SELECT transaction_id AS id FROM receipt_payment_links')
    .get()!.id,
  document.details.transactionId,
);
for (const mutation of [
  "UPDATE attachments SET receipt_details_json=json_set(receipt_details_json,'$.state','scheduled')",
  "UPDATE attachments SET receipt_details_json=json_set(receipt_details_json,'$.ambiguous',json('true'))",
  'UPDATE users SET active=0',
]) {
  seed();
  addReceipt();
  adapter.database.exec(mutation);
  await sync();
  await check(300000, 1);
}
seed();
addReceipt();
adapter.database.exec(
  "UPDATE attachments SET receipt_details_json=json_set(receipt_details_json,'$.state','scheduled')",
);
await sync();
await assert.rejects(
  registerFirstReceiptPix(
    db,
    scope,
    (await state())!,
    { operationId: 'explicit', pixAccountId: 'bank', requestDetails: '{}' },
    100,
  ),
  /documento|pagamento/i,
);
// Explicit registration must honor a known recipient and retain claims after deletion.
seed();
addReceipt();
await assert.rejects(
  registerFirstReceiptPix(
    db,
    scope,
    (await state())!,
    { operationId: 'wrong-bank', pixAccountId: 'bank2', requestDetails: '{}' },
    100,
  ),
  /conta|recebedor/i,
);
await registerFirstReceiptPix(
  db,
  scope,
  (await state())!,
  { operationId: 'explicit-valid', pixAccountId: 'bank', requestDetails: '{}' },
  100,
);
await check(710000, 2);
adapter.database.exec(
  "DELETE FROM attachments WHERE id='r1'; INSERT INTO sales(id,store_id,number,customer_name,seller_user_id,seller_name,products_total_cents,received_total_cents,received_difference_cents,reference_total_cents,price_difference_cents,created_at) VALUES('second','shop',2,'Segundo','owner','Teste',410000,0,-410000,410000,0,1)",
);
addReceipt('repeat-explicit');
adapter.database.exec(
  "UPDATE attachments SET sale_id='second' WHERE id='repeat-explicit'",
);
await adapter.batch(
  requestReceiptPaymentSync(
    db,
    { ...scope, saleId: 'second' },
    'duplicate-explicit',
    100,
  ),
);
await settleReceiptPaymentSync(db, 'shop', 'second');
assert.equal(
  (await readReceiptPaymentSync(db, 'shop', 'second'))!.sale.receivedTotalCents,
  0,
);
assert.equal(
  (await readReceiptPaymentSync(db, 'shop', 'second'))!.request?.status,
  'review',
);
// The explicit first-Pix path must also retain its payment allocation when it changes to cash.
seed();
addReceipt();
await registerFirstReceiptPix(
  db,
  scope,
  (await state())!,
  { operationId: 'explicit-cash', pixAccountId: 'bank', requestDetails: '{}' },
  100,
);
adapter.database.exec(
  "UPDATE payments SET method='cash',pix_account_id=NULL,account_name=NULL WHERE method='pix'",
);
await sync();
await check(710000, 2);
assert.equal((await state())!.request?.status, 'review');
await assert.rejects(
  registerFirstReceiptPix(
    db,
    scope,
    (await state())!,
    {
      operationId: 'explicit-again',
      pixAccountId: 'bank',
      requestDetails: '{}',
    },
    100,
  ),
  /alocação|novamente/i,
);
adapter.database.exec(
  "INSERT INTO payments(id,store_id,sale_id,method,pix_account_id,account_name,amount_cents,created_at) VALUES('extra','shop','sale','pix','bank','Conta teste',10000,1); UPDATE sales SET received_total_cents=720000,received_difference_cents=10000",
);
await sync();
await check(720000, 3);
assert.equal((await state())!.request?.status, 'review');
// A new manual Pix must not bypass a previously linked Pix changed into cash.
seed();
addReceipt();
await sync();
adapter.database.exec(
  "UPDATE payments SET method='cash',pix_account_id=NULL,account_name=NULL WHERE method='pix'; INSERT INTO payments(id,store_id,sale_id,method,pix_account_id,account_name,amount_cents,created_at) VALUES('manual','shop','sale','pix','bank','Conta teste',10000,1); UPDATE sales SET received_total_cents=720000,received_difference_cents=10000",
);
await sync();
await check(720000, 3);
assert.equal((await state())!.request?.status, 'review');
// Matching numbers cannot hide documentary review in Overview.
seed();
addReceipt();
adapter.database.exec(
  "UPDATE attachments SET receipt_details_json=json_set(receipt_details_json,'$.state','scheduled')",
);
await sync();
adapter.database.exec(
  "UPDATE sales SET received_total_cents=710000,received_difference_cents=0; INSERT INTO payments(id,store_id,sale_id,method,pix_account_id,account_name,amount_cents,created_at) VALUES('manual','shop','sale','pix','bank','Conta teste',410000,1)",
);
const page = await readOverview(
  db,
  new URL('https://fixture.test?period=all&comparison=review'),
  'shop',
);
assert.equal(page.items.length, 1);
assert.equal(overviewComparison(page.totals), 'review');
assert.equal(overviewSaleComparison(page.items[0]), 'review');
assert.equal(
  (
    await readOverview(
      db,
      new URL('https://fixture.test?period=all&comparison=matched'),
      'shop',
    )
  ).items.length,
  0,
);
// CAS race: a manual edit between snapshot and write rolls back the whole auto import.
seed();
addReceipt();
await adapter.batch(requestReceiptPaymentSync(db, scope, 'race', Date.now()));
const raced = {
  prepare: adapter.prepare.bind(adapter),
  batch: async (statements: { sql: string }[]) => {
    if (statements.some((p) => p.sql.includes("'sale.payment_from_receipts'")))
      adapter.database.exec(
        "UPDATE payments SET amount_cents=290000 WHERE id='cash'; UPDATE sales SET received_total_cents=290000,received_difference_cents=-420000",
      );
    return adapter.batch(statements);
  },
} as unknown as D1Database;
await settleReceiptPaymentSync(raced, 'shop', 'sale');
await check(290000, 1);
globalThis.fetch = originalFetch;
adapter.close();
console.log(
  'PASS: receipt parser, empty/cash sale, identified bank, idempotent Pix/reread, manual precedence, duplicates, review parity and atomic races.',
);
