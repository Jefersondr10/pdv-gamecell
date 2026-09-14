import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import {
  extractReceiptDocument,
  parseReceiptDocument,
  preferReceiptReading,
  receiptDataWarnings,
  receiptEvidenceKey,
  shortReceiptDate,
} from '../lib/receipt-document.ts';
import { processReceiptJob } from '../lib/server/node/receipt-jobs.mjs';
import { retryReceipt } from '../lib/server/retry-receipt.ts';
import { deleteSaleReceipt } from '../lib/server/delete-receipt.ts';
import {
  refreshSaleReceivedTotals,
  refreshStoreReceivedTotals,
} from '../lib/server/sale-received-totals.ts';
import {
  readReceiptPaymentSync,
  registerFirstReceiptPix,
  requestReceiptPaymentSync,
  settleReceiptPaymentSync,
  stopReceiptPaymentSync,
  processReceiptPaymentSync,
} from '../lib/server/receipt-payment-sync.ts';
import {
  receiptEvidenceProblem,
  releaseCancelledSaleReceiptLinks,
  requeueReceiptsBlockedByCancelledSale,
} from '../lib/server/receipt-evidence-safety.ts';
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

const valueOnly = extractReceiptDocument('Valor R$ 4.400,00');
assert.equal(valueOnly.amountCents, 440000);
assert.equal(valueOnly.details.state, 'unknown');
assert.equal(valueOnly.details.automaticEligible, true);
assert.deepEqual(
  new Set(receiptDataWarnings(valueOnly.details).map((warning) => warning.key)),
  new Set([
    'completion_status',
    'transaction_id',
    'paid_at',
    'payer_name',
    'payer_bank',
    'recipient_name',
    'recipient_bank',
    'recipient_document',
  ]),
);

const mercadoPagoWithoutCanonicalE2e = extractReceiptDocument(`
Mercado Pago
Comprovante de Pix
13/setembro/2026 às 13:41:02
R$ 4.400
Origem e destino
Empresa pagadora LTDA
Mercado Pago
CNPJ: 00.000.000/0001-00
bind
Empresa recebedora LTDA
MT INSTITUICAO DE PAGAMENTO SA
CNPJ: 11.111.111/0001-11
N.º transação do Mercado Pago
123456789012
ID de transação Pix
E105735212026091316408nhD9LqTjdZz
`);
assert.equal(mercadoPagoWithoutCanonicalE2e.amountCents, 440000);
assert.equal(mercadoPagoWithoutCanonicalE2e.details.transactionId, null);
assert.equal(
  mercadoPagoWithoutCanonicalE2e.details.alternateTransactionId,
  'mercado-pago:123456789012',
);
assert.equal(
  mercadoPagoWithoutCanonicalE2e.details.recipientName,
  'Empresa recebedora LTDA',
);
assert.equal(mercadoPagoWithoutCanonicalE2e.details.automaticEligible, true);

const mercadoPagoWithPromotionalPixExample = extractReceiptDocument(`
Comprovante de Pix
R$ 15.000
Pagamento fornec
Origem e destino
LUMORAIMPORT LTDA
Mercado Pago
Dias Imoveis e Construcoes Ltd
MT INSTITUICAO DE PAGAMENTO SA
ID de transacao Pix
E10573521202609082051A4DAXPDZCCD
Faça um Pix de R$ 50 para Ana
`);
assert.equal(mercadoPagoWithPromotionalPixExample.amountCents, 1_500_000);
assert.equal(mercadoPagoWithPromotionalPixExample.details.ambiguous, false);
assert.equal(
  mercadoPagoWithPromotionalPixExample.details.automaticEligible,
  true,
  'a promotional Mercado Pago Pix example must not downgrade a valid receipt',
);

for (const promotionalFooter of [
  'Cashback de R$ 10,00',
  'Economize R$ 50,00',
  'Seguro por R$ 5,00',
  'Pague com Pix e ganhe R$ 20,00',
  'Compra protegida até R$ 1.500,00',
  'Valor máximo por Pix: R$ 20.000,00',
  'Total da sua fatura R$ 2.000,00',
]) {
  const withPromotion = extractReceiptDocument(
    `Comprovante de Pix\nValor da transação\nR$ 1.000,00\nPix realizado\n${promotionalFooter}`,
  );
  assert.equal(withPromotion.amountCents, 100_000, promotionalFooter);
  assert.equal(withPromotion.details.ambiguous, false, promotionalFooter);
  assert.equal(
    withPromotion.details.automaticEligible,
    true,
    promotionalFooter,
  );
}

const itauSisPagText = `
08 set. 2026, 12:08:24, via SISPAG no app Itaú
tipo de transferência
PIX TRANSFERENCIA
valor da transferência
R$ 4.250,00
de
Empresa pagadora LTDA
agência 0001 conta 00001-1
CPF ou CNPJ 00.000.000/0001-00
para
Empresa recebedora LTDA
MT IP S.A.
CPF ou CNPJ 11.111.111/0001-11
chave 11111111-1111-1111-1111-111111111111
ID da transação
E60701190202609081507DY5H11W7NYC
controle 123456789
`;
const itauSisPag = extractReceiptDocument(itauSisPagText);
assert.equal(itauSisPag.amountCents, 425000);
assert.equal(itauSisPag.details.state, 'completed');
assert.equal(itauSisPag.details.automaticEligible, true);
assert.equal(itauSisPag.details.recipientBank, 'MT IP S.A.');
assert.equal(itauSisPag.details.paidAtText, '08 set. 2026, 12:08:24');
assert.equal(
  shortReceiptDate(itauSisPag.details.paidAtText),
  '08/09/2026 · 12:08',
);
assert.equal(
  extractReceiptDocument(`${itauSisPagText}\nAgendado`).details
    .automaticEligible,
  false,
);
assert.equal(
  extractReceiptDocument(`${itauSisPagText}\nEm processamento`).details
    .automaticEligible,
  false,
);
assert.equal(
  extractReceiptDocument(`${itauSisPagText}\nCancelado`).details
    .automaticEligible,
  false,
);

const truncatedInterId = extractReceiptDocument(`
Comprovante de Pix
Pix realizado
10/09/2026 10:20
Valor da transferência
R$ 4.350,00
Pagador
Empresa pagadora
Recebedor
Empresa recebedora
ID datransaç...
E${'6'.repeat(31)}
`);
assert.equal(truncatedInterId.details.transactionId, `E${'6'.repeat(31)}`);
assert.equal(truncatedInterId.details.automaticEligible, true);

const pagBankText = `
Comprovante de envio de Pix
Valor R$ 4.500,00
Código da transação Pix
E${'7'.repeat(31)}
`;
const pagBank = extractReceiptDocument(pagBankText);
assert.equal(pagBank.details.transactionId, `E${'7'.repeat(31)}`);
assert.equal(pagBank.details.state, 'completed');
assert.equal(pagBank.details.automaticEligible, true);
assert.equal(
  extractReceiptDocument(`${pagBankText}\nEm processamento`).details
    .automaticEligible,
  false,
);
assert.equal(
  extractReceiptDocument(
    `${pagBankText}\n${pagBankText.replace('4.500,00', '5.500,00')}`,
  ).details.automaticEligible,
  false,
  'repeated PagBank sections with different amounts are ambiguous',
);
const brokenPagBankHeading = pagBankText.replace(
  'Comprovante de envio de Pix',
  'Comprovante de\nenvio Pix',
);
assert.equal(
  extractReceiptDocument(
    `${brokenPagBankHeading}\n${brokenPagBankHeading.replace('4.500,00', '5.500,00')}`,
  ).details.automaticEligible,
  false,
  'broken OCR headings still separate receipts with different amounts',
);

const mercadoPagoBlock = (institutionId: string) => `
Mercado Pago
Comprovante de Pix
13/setembro/2026 às 13:41:02
R$ 4.400
Origem e destino
Empresa pagadora LTDA
Mercado Pago
CNPJ: 00.000.000/0001-00
Empresa recebedora LTDA
MT INSTITUICAO DE PAGAMENTO SA
CNPJ: 11.111.111/0001-11
N.º transação do Mercado Pago
${institutionId}
`;
assert.equal(
  extractReceiptDocument(
    `${mercadoPagoBlock('123456789012')}\n${mercadoPagoBlock('999999999999')}`,
  ).details.automaticEligible,
  false,
);
assert.equal(
  extractReceiptDocument(
    `${mercadoPagoBlock('123456789012')}\n${mercadoPagoBlock('123456789012')}`,
  ).details.ambiguous,
  false,
);
const mercadoReading = (providerId: string, canonicalCharacter: string) =>
  extractReceiptDocument(`
${mercadoPagoBlock(providerId)}
ID de transação Pix
E${canonicalCharacter.repeat(31)}
`);
const canonicalOnlyReading = (canonicalCharacter: string) =>
  extractReceiptDocument(`
Comprovante de Pix
Pix realizado
R$ 4.400,00
ID de transação Pix
E${canonicalCharacter.repeat(31)}
`);
assert.equal(
  preferReceiptReading([
    mercadoReading('123456789012', 'D'),
    canonicalOnlyReading('D'),
  ]).details.automaticEligible,
  true,
  'readings that share the canonical E2E describe the same payment',
);
assert.equal(
  preferReceiptReading([
    mercadoReading('123456789012', 'D'),
    mercadoReading('123456789012', 'F'),
  ]).details.automaticEligible,
  true,
  'readings that share the provider transaction number describe the same payment',
);
assert.equal(
  preferReceiptReading([
    mercadoReading('123456789012', 'D'),
    mercadoReading('999999999999', 'F'),
  ]).details.automaticEligible,
  false,
  'readings with disjoint transaction identities must remain under review',
);

for (const santanderIdLabel of ['ID/Transação', 'IDfTransação']) {
  const santander = extractReceiptDocument(`
Comprovante do pagamento
Tipo de transferência: Pix
Valor R$ 4.600,00
${santanderIdLabel}
E${'8'.repeat(31)}
`);
  assert.equal(santander.details.transactionId, `E${'8'.repeat(31)}`);
  assert.equal(santander.details.state, 'completed');
  assert.equal(santander.details.automaticEligible, true);
}

const splitPicPayId = `E${'9'.repeat(31)}`;
const picPay = extractReceiptDocument(`
Comprovante de Pix
Pix realizado
Valor R$ 4.700,00
ID da transação
${splitPicPayId.slice(0, 28)}
${splitPicPayId.slice(28)}
`);
assert.equal(picPay.details.transactionId, splitPicPayId);
assert.equal(picPay.details.automaticEligible, true);

const bradescoCompletedText = `
Comprovante de transferência
Dados de quem recebeu
Nome: Empresa recebedora LTDA
Instituição Destino: MT IP S.A.
Dados da Transferência
Valor
R$ 4.800,00
Identificação:
E${'A'.repeat(31)}
Debitado da
Instituição Origem: BANCO BRADESCO S.A.
`;
const bradescoCompleted = extractReceiptDocument(bradescoCompletedText);
assert.equal(bradescoCompleted.details.state, 'completed');
assert.equal(bradescoCompleted.details.automaticEligible, true);
assert.equal(bradescoCompleted.details.payerBank, 'BANCO BRADESCO S.A.');
assert.equal(
  extractReceiptDocument(
    `${bradescoCompletedText}\nOperação sujeita a análise. O crédito será efetuado em instantes.`,
  ).details.automaticEligible,
  false,
);

const bradescoNetEmpresaText = `
Comprovante de Transação Bancária
Pix
Data da operação: 13/09/2026 - 15h10
Nº de controle: 196232357301499837 | Documento: 1510383
Conta de débito: Agência: 2219 | Conta: 0074432-8 | Tipo: Conta-Corrente
Empresa: GUBIO IMPORT COMERCIO E SERVICOS LTDA | CNPJ: 040.208.817/0001-74
Nome do favorecido: DIAS IMOVEIS E CONSTRUCOE
CNPJ/CPF: 061.120.555/0001-61
Instituição Destino: MT IP S.A.
Agência e Conta: 0001 | 0307920 | Conta-Poupança
Chave: 344d13ee-583f-4883-be93-a0373b68abbf
Valor: R$ 14.940,00
Tarifa: R$ 0,00
Mídia: BRADESCO CELULAR - P.JURIDICA
Identificação: E60746948202609131810C2219IUu8dA
TXID: -
Debitado da: Conta-Corrente
Instituição Origem: Banco Bradesco S.A.
A transação acima foi realizada por meio do Bradesco Net Empresa e está sujeita a análise. O crédito será efetuado em instantes.
`;
const assertBradescoNetEmpresa = (input: string) => {
  const reading = extractReceiptDocument(input);
  assert.equal(reading.amountCents, 1_494_000);
  assert.equal(
    reading.details.transactionId,
    'E60746948202609131810C2219IUU8DA',
  );
  assert.equal(reading.details.state, 'completed');
  assert.equal(reading.details.blocked, false);
  assert.equal(reading.details.automaticEligible, true);
  assert.equal(
    reading.details.payerName,
    'GUBIO IMPORT COMERCIO E SERVICOS LTDA',
  );
  assert.equal(reading.details.payerBank, 'Banco Bradesco S.A.');
  assert.equal(reading.details.recipientName, 'DIAS IMOVEIS E CONSTRUCOE');
  assert.equal(reading.details.recipientBank, 'MT IP S.A.');
  assert.equal(reading.details.recipientDocument, '61120555000161');
  assert.equal(reading.details.paidAtText, '13/09/2026 - 15h10');
};
assertBradescoNetEmpresa(bradescoNetEmpresaText);
// Exact missing-glyph pattern produced while extracting the supplied
// text-based PDF (file.pdf), whose embedded ArialUnicode map is incomplete.
const bradescoNetEmpresaPdfExtraction = bradescoNetEmpresaText
  .replace('Transação', 'Transa��o')
  .replace('Bancária', 'Banc�ria')
  .replaceAll('operação', 'opera��o')
  .replace('Nº', 'N�')
  .replaceAll('débito', 'd�bito')
  .replaceAll('Agência', 'Ag�ncia')
  .replaceAll('Instituição', 'Institui��o')
  .replace('Poupança', 'Poupan�a')
  .replace('Mídia', 'M�dia')
  .replace('Identificação', 'Identifica��o')
  .replace('transação', 'transa��o')
  .replace('está', 'est�')
  .replace('análise', 'an�lise')
  .replace('crédito', 'cr�dito')
  .replace('será', 'ser�');
assert.match(bradescoNetEmpresaPdfExtraction, /\uFFFD/);
assertBradescoNetEmpresa(bradescoNetEmpresaPdfExtraction);

const bradescoStillPending = extractReceiptDocument(
  `${bradescoNetEmpresaText}\nPagamento em processamento`,
);
assert.equal(bradescoStillPending.details.state, 'unknown');
assert.equal(bradescoStillPending.details.blocked, true);
assert.equal(bradescoStillPending.details.automaticEligible, false);

const observedId = `E${'B'.repeat(32)}`;
const interWithStableLongId = () =>
  extractReceiptDocument(`
Comprovante de Pix
Pix realizado
Valor R$ 4.900,00
ID da transação
${observedId}
`);
assert.equal(interWithStableLongId().details.automaticEligible, true);
const consensusInter = preferReceiptReading([
  interWithStableLongId(),
  interWithStableLongId(),
]);
assert.equal(consensusInter.details.automaticEligible, true);
assert.equal(
  consensusInter.details.alternateTransactionId,
  `ocr-consensus:${observedId}`,
);
assert.equal(
  receiptEvidenceKey(consensusInter.details),
  `ocr-consensus:${observedId}`,
);
const canonicalBeforeObservedConsensus = preferReceiptReading([
  extractReceiptDocument(text(4, undefined, undefined, '4.900,00')),
  interWithStableLongId(),
  interWithStableLongId(),
]);
assert.equal(
  canonicalBeforeObservedConsensus.details.alternateTransactionId,
  null,
);
assert.equal(
  receiptEvidenceKey(canonicalBeforeObservedConsensus.details),
  `E${String(4).padStart(31, '0')}`,
);
const canonicalBeforeConflictingObserved = preferReceiptReading([
  extractReceiptDocument(text(4, undefined, undefined, '4.900,00')),
  interWithStableLongId(),
  extractReceiptDocument(`
Comprovante de Pix
Pix realizado
Valor R$ 4.900,00
ID da transação
E${'C'.repeat(32)}
`),
]);
assert.equal(
  canonicalBeforeConflictingObserved.details.automaticEligible,
  true,
);
assert.equal(canonicalBeforeConflictingObserved.details.ambiguous, false);
const conflictingObserved = preferReceiptReading([
  interWithStableLongId(),
  extractReceiptDocument(`
Comprovante de Pix
Pix realizado
Valor R$ 4.900,00
ID da transação
E${'C'.repeat(32)}
`),
]);
assert.equal(conflictingObserved.details.automaticEligible, false);
assert.equal(conflictingObserved.details.ambiguous, true);

for (const invalidId of [
  `E${'D'.repeat(30)}`,
  `E${'D'.repeat(32)}`,
  `E${'D'.repeat(30)}!`,
]) {
  assert.equal(
    parseReceiptDocument({ ...document.details, transactionId: invalidId }),
    null,
  );
}
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
  extractReceiptDocument(text() + '\n' + text()).details.automaticEligible,
  true,
  'the same identifier and amount repeated by OCR are not ambiguous',
);
assert.equal(
  extractReceiptDocument(
    `${text()}\n${text(1, undefined, undefined, '5.100,00')}`,
  ).details.automaticEligible,
  false,
  'the same identifier cannot hide two different transaction amounts',
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
const check = async (
  received: number,
  count: number,
  historicalPaymentTotal = received,
) => {
  const s = (await state())!;
  assert.equal(s.sale.receivedTotalCents, received);
  assert.equal(s.payments.length, count);
  assert.equal(
    s.payments.reduce((sum, p) => sum + p.amountCents, 0),
    historicalPaymentTotal,
  );
  return s;
};

// A create request with a browser-confirmed receipt starts from cash-only input,
// then refreshes to the canonical cash + accepted-receipt total. The operation
// guard must match the expected audit action as well as its id and sale.
seed(0);
addReceipt();
adapter.database.exec(
  `INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
   VALUES('create-audit','shop','owner','sale.created','sale','sale','{}',1)`,
);
await refreshSaleReceivedTotals(db, 'shop', 'sale', {
  auditId: 'create-audit',
  auditAction: 'sale.receipt_reread',
  auditEntityId: 'sale',
}).run();
await check(0, 0);
await refreshSaleReceivedTotals(db, 'shop', 'sale', {
  auditId: 'create-audit',
  auditAction: 'sale.created',
  auditEntityId: 'sale',
}).run();
await check(410000, 0, 0);

seed(0);
await check(0, 0);
addReceipt();
await sync();
await check(410000, 1);

// A value-only receipt gets a stable attachment fallback. Rereading the same
// attachment updates the existing Pix instead of creating a second payment.
seed(0, 440000);
adapter.database
  .prepare(
    `INSERT INTO attachments(id,store_id,kind,sale_id,r2_key,file_name,mime_type,size_bytes,receipt_amount_cents,receipt_amount_source,receipt_amount_confirmed_at,receipt_details_json,created_by,created_at) VALUES('value-only','shop','receipt','sale','value-only','value-only.png','image/png',4,440000,'ocr',1,?,'owner',1)`,
  )
  .run(JSON.stringify(valueOnly.details));
await sync();
let valueOnlyState = await check(440000, 1);
const valueOnlyPaymentId = valueOnlyState.payments[0].id;
assert.equal(
  adapter.database
    .prepare(
      "SELECT transaction_id AS transactionId FROM receipt_payment_links WHERE attachment_id='value-only'",
    )
    .get()!.transactionId,
  'receipt:value-only',
);
adapter.database
  .prepare(
    "UPDATE attachments SET receipt_details_json=?,receipt_amount_confirmed_at=2 WHERE id='value-only'",
  )
  .run(
    JSON.stringify(
      extractReceiptDocument('Comprovante de Pix\nR$ 4.400,00').details,
    ),
  );
await sync();
valueOnlyState = await check(440000, 1);
assert.equal(valueOnlyState.payments[0].id, valueOnlyPaymentId);

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
adapter.database.exec(
  "UPDATE sales SET received_total_cents=999,received_difference_cents=999 WHERE id='sale'",
);
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
assert.equal(
  s.sale.effectiveReceiptTotalCents,
  0,
  'a receipt under a genuine allocation review is not counted on top of cash',
);
assert.match(
  s.receipts[0].review ?? '',
  /alterado|alocação|pagamento/i,
  'the financial hold remains explicit for review',
);
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
s = await check(550000, 3, 960000);
assert.equal(s.request?.status, 'review');
seed();
addReceipt();
await sync();
adapter.database.exec("DELETE FROM attachments WHERE id='r1'");
addReceipt('replacement', 1);
await sync();
s = await check(300000, 2, 710000);
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

// A cancelled sale retains its immutable history but no longer reserves the
// Pix identity. A historical stale link is transferred atomically to the
// active replacement sale, without deleting the cancelled payment or proof.
seed(0, 410000);
const replacementReading = addReceipt('replacement-proof');
adapter.database.exec(`
  INSERT INTO sales(id,store_id,number,customer_name,seller_user_id,seller_name,status,products_total_cents,received_total_cents,received_difference_cents,reference_total_cents,price_difference_cents,created_at)
  VALUES('cancelled-sale','shop',2,'Cancelada','owner','Teste','cancelled',410000,410000,0,410000,0,1);
`);
addReceipt('cancelled-proof');
adapter.database.exec(`
  UPDATE attachments SET sale_id='cancelled-sale' WHERE id='cancelled-proof';
  INSERT INTO payments(id,store_id,sale_id,method,account_name,amount_cents,created_at)
  VALUES('cancelled-pix','shop','cancelled-sale','pix','Conta histórica',410000,1);
`);
adapter.database
  .prepare(
    `INSERT INTO receipt_payment_links(attachment_id,store_id,sale_id,payment_id,transaction_id,created_at)
     VALUES('cancelled-proof','shop','cancelled-sale','cancelled-pix',?,1)`,
  )
  .run(receiptEvidenceKey(replacementReading.details)!);
adapter.database
  .prepare(
    `INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
     VALUES('cancelled-claim','shop','owner','sale.receipt_transaction_claimed','attachment','cancelled-proof',?,1)`,
  )
  .run(
    JSON.stringify({
      transactionId: receiptEvidenceKey(replacementReading.details),
      saleId: 'cancelled-sale',
      paymentIds: ['cancelled-pix'],
    }),
  );
await sync();
await check(410000, 1);
assert.deepEqual(
  adapter.database
    .prepare(
      'SELECT attachment_id AS attachmentId,sale_id AS saleId FROM receipt_payment_links',
    )
    .all()
    .map((row) => ({ ...row })),
  [{ attachmentId: 'replacement-proof', saleId: 'sale' }],
  'the active sale owns the transaction after the atomic transfer',
);
assert.equal(
  adapter.database
    .prepare("SELECT COUNT(*) AS n FROM payments WHERE id='cancelled-pix' AND sale_id='cancelled-sale'")
    .get()!.n,
  1,
  'the cancelled payment remains available in history',
);
assert.equal(
  adapter.database
    .prepare("SELECT COUNT(*) AS n FROM attachments WHERE id='cancelled-proof' AND sale_id='cancelled-sale'")
    .get()!.n,
  1,
  'the cancelled proof remains available in history',
);
assert.equal(
  adapter.database
    .prepare("SELECT COUNT(*) AS n FROM audit_events WHERE id='cancelled-claim'")
    .get()!.n,
  1,
  'the cancelled transaction claim remains in the immutable audit trail',
);

// The same transfer also covers a provisional value-only link promoted to a
// canonical Pix identity after rereading the active attachment.
seed(0, 440000);
adapter.database
  .prepare(
    `INSERT INTO attachments(id,store_id,kind,sale_id,r2_key,file_name,mime_type,size_bytes,receipt_amount_cents,receipt_amount_source,receipt_amount_confirmed_at,receipt_details_json,created_by,created_at)
     VALUES('promoted-proof','shop','receipt','sale','promoted-proof','promoted.png','image/png',4,440000,'ocr',1,?,'owner',1)`,
  )
  .run(JSON.stringify(valueOnly.details));
await sync();
const promotedPaymentId = (await state())!.payments[0].id;
assert.equal(
  adapter.database
    .prepare("SELECT transaction_id AS id FROM receipt_payment_links WHERE attachment_id='promoted-proof'")
    .get()!.id,
  'receipt:promoted-proof',
);
adapter.database.exec(`
  INSERT INTO sales(id,store_id,number,customer_name,seller_user_id,seller_name,status,products_total_cents,received_total_cents,received_difference_cents,reference_total_cents,price_difference_cents,created_at)
  VALUES('cancelled-promotion','shop',2,'Cancelada','owner','Teste','cancelled',440000,440000,0,440000,0,1);
`);
const canonicalReading = addReceipt(
  'cancelled-canonical',
  9,
  'Banco Recebedor',
  '12345678000199',
  '4.400,00',
);
adapter.database.exec(`
  UPDATE attachments SET sale_id='cancelled-promotion' WHERE id='cancelled-canonical';
  INSERT INTO payments(id,store_id,sale_id,method,account_name,amount_cents,created_at)
  VALUES('cancelled-canonical-pix','shop','cancelled-promotion','pix','Conta histórica',440000,1);
`);
adapter.database
  .prepare(
    `INSERT INTO receipt_payment_links(attachment_id,store_id,sale_id,payment_id,transaction_id,created_at)
     VALUES('cancelled-canonical','shop','cancelled-promotion','cancelled-canonical-pix',?,1)`,
  )
  .run(receiptEvidenceKey(canonicalReading.details)!);
adapter.database
  .prepare(
    `UPDATE attachments SET receipt_details_json=?,receipt_amount_confirmed_at=2
     WHERE id='promoted-proof'`,
  )
  .run(JSON.stringify(canonicalReading.details));
await sync();
await check(440000, 1);
assert.equal(
  (await state())!.payments[0].id,
  promotedPaymentId,
  'identity promotion keeps the same active Pix payment',
);
assert.deepEqual(
  adapter.database
    .prepare(
      'SELECT attachment_id AS attachmentId,transaction_id AS transactionId FROM receipt_payment_links',
    )
    .all()
    .map((row) => ({ ...row })),
  [
    {
      attachmentId: 'promoted-proof',
      transactionId: receiptEvidenceKey(canonicalReading.details),
    },
  ],
);
assert.equal(
  adapter.database
    .prepare("SELECT COUNT(*) AS n FROM payments WHERE id='cancelled-canonical-pix'")
    .get()!.n,
  1,
  'the old payment remains even when a provisional link is promoted',
);

// A future cancellation releases every operational Pix link and reopens only
// replacement sales that were blocked by the same transaction identity.
seed(0, 410000);
const blockedReading = addReceipt('blocked-proof');
adapter.database.exec(`
  INSERT INTO sales(id,store_id,number,customer_name,seller_user_id,seller_name,products_total_cents,received_total_cents,received_difference_cents,reference_total_cents,price_difference_cents,created_at)
  VALUES('original-sale','shop',2,'Original','owner','Teste',410000,410000,0,410000,0,1);
`);
addReceipt('original-proof');
adapter.database.exec(`
  UPDATE attachments SET sale_id='original-sale' WHERE id='original-proof';
  INSERT INTO payments(id,store_id,sale_id,method,account_name,amount_cents,created_at)
  VALUES('original-pix','shop','original-sale','pix','Conta original',410000,1);
`);
adapter.database
  .prepare(
    `INSERT INTO receipt_payment_links(attachment_id,store_id,sale_id,payment_id,transaction_id,created_at)
     VALUES('original-proof','shop','original-sale','original-pix',?,1)`,
  )
  .run(receiptEvidenceKey(blockedReading.details)!);
await sync();
assert.equal((await state())!.request?.status, 'review');
const cancellationDetails = JSON.stringify({ reason: 'Venda substituída' });
await adapter.batch([
  db
    .prepare("UPDATE sales SET status='cancelled' WHERE id='original-sale' AND store_id='shop'")
    .bind(),
  db
    .prepare(
      `INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
       VALUES('cancel-original','shop','owner','sale.cancelled','sale','original-sale',?,2)`,
    )
    .bind(cancellationDetails),
  releaseCancelledSaleReceiptLinks(
    db,
    'shop',
    'original-sale',
    'cancel-original',
  ),
  requeueReceiptsBlockedByCancelledSale(
    db,
    {
      storeId: 'shop',
      cancelledSaleId: 'original-sale',
      actorId: 'owner',
      requestId: 'cancel-release:original-sale',
      cancellationAuditId: 'cancel-original',
    },
    2,
  ),
  refreshStoreReceivedTotals(db, 'shop', {
    auditId: 'cancel-original',
    auditAction: 'sale.cancelled',
    auditEntityId: 'original-sale',
  }),
]);
assert.equal(
  adapter.database
    .prepare("SELECT COUNT(*) AS n FROM receipt_payment_links WHERE sale_id='original-sale'")
    .get()!.n,
  0,
  'cancellation releases all receipt transaction links',
);
assert.equal((await state())!.request?.status, 'pending');
assert.equal(
  (await state())!.sale.receivedTotalCents,
  410000,
  'the replacement balance refreshes as soon as cancellation releases the duplicate',
);
await settleReceiptPaymentSync(db, 'shop', 'sale');
await check(410000, 1);

// Every reopened sale gets its own request identity. This prevents the global
// audit id from colliding when one cancellation unblocks several replacements.
seed(0, 410000);
addReceipt('first-replacement', 21);
adapter.database.exec(`
  INSERT INTO sales(id,store_id,number,customer_name,seller_user_id,seller_name,status,products_total_cents,received_total_cents,received_difference_cents,reference_total_cents,price_difference_cents,created_at)
  VALUES('cancelled-multi','shop',2,'Cancelada','owner','Teste','cancelled',820000,820000,0,820000,0,1),
        ('second-replacement','shop',3,'Substituta 2','owner','Teste','completed',410000,0,-410000,410000,0,1);
  INSERT INTO sale_receipt_payment_sync(sale_id,store_id,request_id,requested_by,status,updated_at)
  VALUES('sale','shop','review:first','owner','review',1),
        ('second-replacement','shop','in-flight:second','owner','pending',1);
`);
addReceipt('cancelled-multi-proof-1', 21);
adapter.database.exec(
  "UPDATE attachments SET sale_id='cancelled-multi' WHERE id='cancelled-multi-proof-1'",
);
addReceipt('second-replacement-proof', 22);
adapter.database.exec(
  "UPDATE attachments SET sale_id='second-replacement' WHERE id='second-replacement-proof'",
);
addReceipt('cancelled-multi-proof-2', 22);
adapter.database.exec(
  "UPDATE attachments SET sale_id='cancelled-multi' WHERE id='cancelled-multi-proof-2'",
);
adapter.database.exec(`
  INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
  VALUES('cancel-multi','shop','owner','sale.cancelled','sale','cancelled-multi','{}',2);
`);
await adapter.batch([
  requeueReceiptsBlockedByCancelledSale(
    db,
    {
      storeId: 'shop',
      cancelledSaleId: 'cancelled-multi',
      actorId: 'owner',
      requestId: 'cancel-release:multi',
      cancellationAuditId: 'cancel-multi',
    },
    2,
  ),
]);
assert.deepEqual(
  adapter.database
    .prepare(
      "SELECT sale_id AS saleId,request_id AS requestId,status FROM sale_receipt_payment_sync ORDER BY sale_id",
    )
    .all()
    .map((row) => ({ ...row })),
  [
    {
      saleId: 'sale',
      requestId: 'cancel-release:multi:sale',
      status: 'pending',
    },
    {
      saleId: 'second-replacement',
      requestId: 'cancel-release:multi:second-replacement',
      status: 'pending',
    },
  ],
);

// A cancellation must never reopen or erase a genuine manual hold, even when
// another receipt in that sale shares the cancelled transaction identity.
seed(0, 410000);
addReceipt('manual-hold-target', 31);
adapter.database.exec(`
  UPDATE attachments SET receipt_review_reason='Revisão manual' WHERE id='manual-hold-target';
  INSERT INTO sales(id,store_id,number,customer_name,seller_user_id,seller_name,status,products_total_cents,received_total_cents,received_difference_cents,reference_total_cents,price_difference_cents,created_at)
  VALUES('cancelled-manual-hold','shop',2,'Cancelada','owner','Teste','cancelled',410000,410000,0,410000,0,1);
  INSERT INTO sale_receipt_payment_sync(sale_id,store_id,request_id,requested_by,status,updated_at)
  VALUES('sale','shop','review:manual','owner','review',1);
`);
addReceipt('cancelled-manual-proof', 31);
adapter.database.exec(`
  UPDATE attachments SET sale_id='cancelled-manual-hold' WHERE id='cancelled-manual-proof';
  INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
  VALUES('cancel-manual-hold','shop','owner','sale.cancelled','sale','cancelled-manual-hold','{}',2);
`);
await adapter.batch([
  requeueReceiptsBlockedByCancelledSale(
    db,
    {
      storeId: 'shop',
      cancelledSaleId: 'cancelled-manual-hold',
      actorId: 'owner',
      requestId: 'cancel-release:manual-hold',
      cancellationAuditId: 'cancel-manual-hold',
    },
    2,
  ),
]);
assert.equal((await state())!.request?.status, 'review');
assert.equal(
  adapter.database
    .prepare("SELECT receipt_review_reason AS reason FROM attachments WHERE id='manual-hold-target'")
    .get()!.reason,
  'Revisão manual',
);

// Unknown/orphan claims remain fail-closed; only a sale proven cancelled can
// release a transaction identity.
seed(0, 410000);
const orphanReading = addReceipt('orphan-target');
adapter.database
  .prepare(
    `INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
     VALUES('orphan-claim','shop','owner','sale.receipt_transaction_claimed','attachment','missing-proof',?,1)`,
  )
  .run(
    JSON.stringify({
      transactionId: receiptEvidenceKey(orphanReading.details),
      saleId: 'missing-sale',
      paymentIds: ['missing-payment'],
    }),
  );
await sync();
assert.equal((await state())!.request?.status, 'review');
await check(0, 0);
// Transaction identity is store-wide: a reading on another sale invalidates
// both caches, and deleting that duplicate restores the original sale.
seed();
addReceipt();
await sync();
await check(710000, 2);
adapter.database.exec(`
  INSERT INTO sales(id,store_id,number,customer_name,seller_user_id,seller_name,products_total_cents,received_total_cents,received_difference_cents,reference_total_cents,price_difference_cents,created_at)
  VALUES('cross-sale','shop',2,'Outra venda','owner','Teste',410000,0,-410000,410000,0,1);
  INSERT INTO attachments(id,store_id,kind,sale_id,r2_key,file_name,mime_type,size_bytes,created_by,created_at)
  VALUES('cross-receipt','shop','receipt','cross-sale','cross-receipt','cross.png','image/png',4,'owner',1);
  INSERT INTO receipt_ocr_jobs(attachment_id,status,attempts,generation,next_attempt_at,created_at,updated_at)
  VALUES('cross-receipt','pending',0,1,1,1,1);
`);
const beforeCrossSaleFetch = globalThis.fetch;
globalThis.fetch = async () => Response.json(extractReceiptDocument(text()));
await processReceiptJob(
  adapter,
  { get: async () => ({ body: new Blob(['test']).stream() }) },
  'http://fixture.test',
  () => 200,
);
assert.equal(
  (await state())!.sale.receivedTotalCents,
  300000,
  'the original cache drops its now-duplicated receipt immediately',
);
assert.equal(
  (await readReceiptPaymentSync(db, 'shop', 'cross-sale'))!.sale
    .receivedTotalCents,
  0,
);
await deleteSaleReceipt(
  db,
  { delete: async () => {} },
  {
    operationId: 'delete-cross-receipt',
    saleId: 'cross-sale',
    receiptId: 'cross-receipt',
    storeId: 'shop',
    actorId: 'owner',
    subject: { role: 'owner' },
  },
);
assert.equal(
  (await state())!.sale.receivedTotalCents,
  710000,
  'removing the other-sale duplicate restores the original cache',
);
globalThis.fetch = beforeCrossSaleFetch;
// A terminal unreadable receipt leaves review, not an endless pending sync.
seed();
addReceipt();
adapter.database.exec(
  "UPDATE attachments SET receipt_amount_cents=NULL; UPDATE sales SET received_total_cents=710000,received_difference_cents=0; INSERT INTO receipt_ocr_jobs(attachment_id,status,next_attempt_at,created_at,updated_at) VALUES('r1','needs_review',1,1,1)",
);
await adapter.batch(
  requestReceiptPaymentSync(db, scope, 'terminal-read', Date.now()),
);
await processReceiptPaymentSync(db);
assert.equal((await state())!.request?.status, 'review');
await check(300000, 1);
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
// Mercado Pago's own labelled transaction number remains the durable identity
// when OCR alternates between a malformed and a canonical-looking Pix E2E.
seed(0, 440000);
const mercadoWithCanonical = (character: string) =>
  extractReceiptDocument(`
${mercadoPagoBlock('123456789012')}
ID de transação Pix
E${character.repeat(31)}
`);
const mercadoFirstReading = mercadoWithCanonical('D');
const historicalMercadoDetails = {
  ...mercadoFirstReading.details,
  alternateTransactionId: null,
};
adapter.database
  .prepare(
    `INSERT INTO attachments(id,store_id,kind,sale_id,r2_key,file_name,mime_type,size_bytes,receipt_amount_cents,receipt_amount_source,receipt_amount_confirmed_at,receipt_details_json,created_by,created_at) VALUES('mp','shop','receipt','sale','mp','mp.png','image/png',4,440000,'ocr',1,?,'owner',1)`,
  )
  .run(JSON.stringify(historicalMercadoDetails));
await sync();
const mercadoPaymentId = (await state())!.payments.find(
  (payment) => payment.method === 'pix',
)!.id;
adapter.database
  .prepare("UPDATE attachments SET receipt_details_json=? WHERE id='mp'")
  .run(JSON.stringify(mercadoFirstReading.details));
await sync();
await check(440000, 1);
assert.equal(
  (await state())!.payments.find((payment) => payment.method === 'pix')!.id,
  mercadoPaymentId,
);
assert.equal(
  adapter.database
    .prepare(
      "SELECT transaction_id AS id FROM receipt_payment_links WHERE attachment_id='mp'",
    )
    .get()!.id,
  'mercado-pago:123456789012',
);
assert.deepEqual(
  adapter.database
    .prepare(
      "SELECT json_extract(details_json,'$.transactionId') AS id FROM audit_events WHERE entity_id='mp' AND action='sale.receipt_transaction_claimed' ORDER BY id",
    )
    .all()
    .map((row) => row.id)
    .sort((a, b) => String(a).localeCompare(String(b))),
  [`E${'D'.repeat(31)}`, 'mercado-pago:123456789012'].sort(),
);
adapter.database.exec(
  "INSERT INTO sales(id,store_id,number,customer_name,seller_user_id,seller_name,products_total_cents,received_total_cents,received_difference_cents,reference_total_cents,price_difference_cents,created_at) VALUES('mp-second','shop',2,'Segundo','owner','Teste',440000,0,-440000,440000,0,1)",
);
const mercadoSecondReading = mercadoWithCanonical('F');
adapter.database
  .prepare(
    `INSERT INTO attachments(id,store_id,kind,sale_id,r2_key,file_name,mime_type,size_bytes,receipt_amount_cents,receipt_amount_source,receipt_amount_confirmed_at,receipt_details_json,created_by,created_at) VALUES('mp-other','shop','receipt','mp-second','mp-other','mp-other.png','image/png',4,440000,'ocr',1,?,'owner',1)`,
  )
  .run(JSON.stringify(mercadoSecondReading.details));
await adapter.batch(
  requestReceiptPaymentSync(
    db,
    { ...scope, saleId: 'mp-second' },
    'same-mercado-provider-id',
    Date.now(),
  ),
);
await settleReceiptPaymentSync(db, 'shop', 'mp-second');
assert.equal(
  (await readReceiptPaymentSync(db, 'shop', 'mp-second'))!.request?.status,
  'review',
);
assert.equal(
  (await readReceiptPaymentSync(db, 'shop', 'mp-second'))!.sale
    .receivedTotalCents,
  0,
);
adapter.database.exec("DELETE FROM attachments WHERE id='mp-other'");
const sameCanonicalWithoutProviderId = extractReceiptDocument(`
Comprovante de Pix
Pix realizado
R$ 4.400,00
ID de transação Pix
E${'D'.repeat(31)}
`);
adapter.database
  .prepare(
    `INSERT INTO attachments(id,store_id,kind,sale_id,r2_key,file_name,mime_type,size_bytes,receipt_amount_cents,receipt_amount_source,receipt_amount_confirmed_at,receipt_details_json,created_by,created_at) VALUES('mp-canonical-copy','shop','receipt','mp-second','mp-canonical-copy','mp-canonical-copy.png','image/png',4,440000,'ocr',1,?,'owner',1)`,
  )
  .run(JSON.stringify(sameCanonicalWithoutProviderId.details));
await adapter.batch(
  requestReceiptPaymentSync(
    db,
    { ...scope, saleId: 'mp-second' },
    'same-mercado-canonical-id',
    Date.now(),
  ),
);
await settleReceiptPaymentSync(db, 'shop', 'mp-second');
assert.equal(
  (await readReceiptPaymentSync(db, 'shop', 'mp-second'))!.request?.status,
  'review',
);
assert.equal(
  (await readReceiptPaymentSync(db, 'shop', 'mp-second'))!.sale
    .receivedTotalCents,
  0,
);
adapter.database.exec("DELETE FROM attachments WHERE id='mp-canonical-copy'");
// A linked receipt may lose its ID in a later OCR pass. Keep the established
// link instead of creating a second Pix or dropping an already proved receipt.
const idlessReread = extractReceiptDocument(
  'Comprovante de Pix\nPix realizado\nR$ 4.400,00',
);
assert.equal(idlessReread.details.automaticEligible, true);
adapter.database
  .prepare("UPDATE attachments SET receipt_details_json=? WHERE id='mp'")
  .run(JSON.stringify(idlessReread.details));
await sync();
await check(440000, 1);
assert.equal(
  (await state())!.payments.find((payment) => payment.method === 'pix')!.id,
  mercadoPaymentId,
);
adapter.database.exec("DELETE FROM attachments WHERE id='mp'");
adapter.database
  .prepare(
    `INSERT INTO attachments(id,store_id,kind,sale_id,r2_key,file_name,mime_type,size_bytes,receipt_amount_cents,receipt_amount_source,receipt_amount_confirmed_at,receipt_details_json,created_by,created_at) VALUES('mp-after-delete','shop','receipt','mp-second','mp-after-delete','mp-after-delete.png','image/png',4,440000,'ocr',1,?,'owner',1)`,
  )
  .run(JSON.stringify(sameCanonicalWithoutProviderId.details));
await adapter.batch(
  requestReceiptPaymentSync(
    db,
    { ...scope, saleId: 'mp-second' },
    'durable-mercado-alias-claim',
    Date.now(),
  ),
);
await settleReceiptPaymentSync(db, 'shop', 'mp-second');
assert.equal(
  (await readReceiptPaymentSync(db, 'shop', 'mp-second'))!.request?.status,
  'review',
  'a provider receipt alias remains claimed after its original attachment is deleted',
);
assert.equal(
  (await readReceiptPaymentSync(db, 'shop', 'mp-second'))!.sale
    .receivedTotalCents,
  0,
);
for (const mutation of [
  "UPDATE attachments SET receipt_details_json=json_set(receipt_details_json,'$.state','scheduled')",
  "UPDATE attachments SET receipt_details_json=json_set(receipt_details_json,'$.ambiguous',json('true'))",
]) {
  seed();
  addReceipt();
  adapter.database.exec(mutation);
  await sync();
  await check(300000, 1);
}
seed();
addReceipt();
adapter.database.exec('UPDATE users SET active=0');
await sync();
await check(710000, 1, 300000);
assert.equal((await state())!.request?.status, 'review');
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
await check(710000, 3, 720000);
assert.equal((await state())!.request?.status, 'review');
// A new manual Pix must not bypass a previously linked Pix changed into cash.
seed();
addReceipt();
await sync();
adapter.database.exec(
  "UPDATE payments SET method='cash',pix_account_id=NULL,account_name=NULL WHERE method='pix'; INSERT INTO payments(id,store_id,sale_id,method,pix_account_id,account_name,amount_cents,created_at) VALUES('manual','shop','sale','pix','bank','Conta teste',10000,1); UPDATE sales SET received_total_cents=720000,received_difference_cents=10000",
);
await sync();
await check(710000, 3, 720000);
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
