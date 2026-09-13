import assert from 'node:assert/strict';
import {
  extractReceiptDocument,
  needsReceiptOcrEnrichment,
  parseReceiptDocument,
  preferReceiptReading,
  RECEIPT_READER_REVISION,
} from '../lib/receipt-document.ts';
import { receiptIncomeCents } from '../lib/receipt-income.ts';

// Synthetic participant data and identifiers; only the document layout is real.
const id = `E${'0'.repeat(20)}TIBLEG5XELO`;
const alternateId = id.replace('G5', 'GS');
const fixture = (transactionId = id) => `SICOOB
Comprovante de envio Pix
R$ 7.300,00
Transferido em 12/09/2026 às 15:03:38
Comprovante para simples conferência gerado em 12/09/2026 às 15:03:40
Recebedor
Nome
LOJA FICTÍCIA LTDA
CPF/CNPJ
**.***.***/0001-**
Instituição
MT IP S.A.
Pagador
Nome
PESSOA FICTÍCIA
CPF/CNPJ
***.123.***-**
Instituição
COOP SICOOB DE TESTE
ID da transação
${transactionId}`;
const income = (reading: ReturnType<typeof extractReceiptDocument>) =>
  receiptIncomeCents({
    receiptAmountCents: reading.amountCents,
    receiptDetails: reading.details,
  });

assert.equal(id.length, 32);
assert.ok(RECEIPT_READER_REVISION > 1);
const complete = extractReceiptDocument(fixture());
assert.equal(complete.amountCents, 730000);
assert.equal(complete.details.state, 'completed');
assert.equal(complete.details.blocked, false);
assert.equal(complete.details.ambiguous, false);
assert.equal(complete.details.automaticEligible, true);
assert.equal(complete.details.recipientName, 'LOJA FICTÍCIA LTDA');
assert.equal(complete.details.recipientBank, 'MT IP S.A.');
assert.equal(complete.details.payerName, 'PESSOA FICTÍCIA');
assert.equal(complete.details.payerBank, 'COOP SICOOB DE TESTE');
assert.equal(
  complete.details.recipientDocument,
  null,
  'Masked document stays masked',
);
assert.equal(complete.details.paidAtText, '12/09/2026 às 15:03:38');
assert.equal(complete.details.transactionId, id);
assert.equal(income(complete), 730000);
assert.equal(
  needsReceiptOcrEnrichment(complete),
  false,
  'Complete psm6 evidence ends OCR even when CPF/CNPJ is masked',
);
assert.equal(needsReceiptOcrEnrichment(null), true);
assert.equal(needsReceiptOcrEnrichment(extractReceiptDocument('')), true);
assert.deepEqual(
  parseReceiptDocument(JSON.stringify(complete.details)),
  complete.details,
);

for (const text of [
  fixture()
    .replaceAll('Nome\n', 'Nome: ')
    .replaceAll('Instituição\n', 'Instituição: '),
  fixture()
    .replaceAll('Nome\n', 'Nome:\n')
    .replaceAll('Instituição\n', 'Instituição:\n'),
  fixture().replace('Comprovante de envio Pix', 'Comprovante de\nenvio Pix'),
  fixture().replace('Comprovante de envio Pix', 'Comprovante de envio de Pix'),
])
  assert.deepEqual(extractReceiptDocument(text), complete);

for (const [heading, confirmation] of [
  ['Comprovante de pagamento Pix', 'Pagamento realizado'],
  ['Comprovante do pagamento', 'Pix concluído'],
  ['Comprovante de transação Pix', 'Transação foi realizada'],
  ['Confirmação de operação Pix', 'Operação confirmada'],
] as const) {
  const reading = extractReceiptDocument(
    fixture()
      .replace('Comprovante de envio Pix', heading)
      .replace('Transferido em 12/09/2026 às 15:03:38', confirmation),
  );
  assert.equal(reading.details.state, 'completed', heading);
  assert.equal(reading.details.automaticEligible, true, heading);
  assert.equal(income(reading), 730000, heading);
}

const completedWithoutId = extractReceiptDocument(
  'Comprovante de pagamento Pix\nPagamento realizado\nR$ 7.300,00',
);
assert.equal(completedWithoutId.details.state, 'completed');
assert.equal(
  completedWithoutId.details.automaticEligible,
  false,
  'A leitura automática ainda exige um identificador Pix único',
);

for (const text of [
  `Comprovante de pagamento Pix\nPagamento pendente\nR$ 7.300,00\nID da transação\n${id}`,
  `Comprovante de pagamento Pix\nPagamento não realizado\nR$ 7.300,00\nID da transação\n${id}`,
]) {
  const reading = extractReceiptDocument(text);
  assert.notEqual(reading.details.state, 'completed');
  assert.equal(income(reading), 0);
}

const missingName = extractReceiptDocument(
  fixture().replace('LOJA FICTÍCIA LTDA\n', ''),
);
assert.equal(
  missingName.details.recipientName,
  null,
  'A following field cannot become the name',
);
assert.equal(missingName.details.payerName, 'PESSOA FICTÍCIA');
const missingInstitution = extractReceiptDocument(
  fixture().replace('MT IP S.A.\n', ''),
);
assert.equal(
  missingInstitution.details.recipientBank,
  null,
  'Receiver cannot borrow payer bank',
);
assert.equal(needsReceiptOcrEnrichment(missingInstitution), true);
assert.equal(
  extractReceiptDocument(fixture().replace('Instituição\nMT IP S.A.', 'Banco'))
    .details.recipientBank,
  null,
  'An empty bank label cannot identify a bank',
);
assert.equal(
  extractReceiptDocument(fixture().replace('Nome\nLOJA FICTÍCIA LTDA\n', ''))
    .details.recipientName,
  null,
  'Institution/document values cannot substitute for a missing participant',
);
assert.equal(
  extractReceiptDocument(
    'Comprovante de Pix\nRecebedor\nCNPJ: 12345678000199\nLOJA FICTÍCIA LTDA\nBanco: Banco de teste',
  ).details.recipientName,
  'LOJA FICTÍCIA LTDA',
  'An inline field does not consume the following unlabelled name',
);
const unmasked = extractReceiptDocument(
  fixture().replace('**.***.***/0001-**', '12.345.678/0001-99'),
);
assert.equal(unmasked.details.recipientDocument, '12345678000199');

for (const text of [
  fixture().replace('Transferido em 12/09/2026 às 15:03:38\n', ''),
  fixture().replace('Transferido em', 'Solicitado em'),
  fixture().replace('Transferido em', 'Será transferido em'),
  fixture().replace('Comprovante de envio Pix', 'Solicitação de envio Pix'),
]) {
  const reading = extractReceiptDocument(text);
  assert.equal(reading.details.state, 'unknown');
  assert.equal(income(reading), 0);
  assert.equal(needsReceiptOcrEnrichment(reading), true);
}
for (const status of [
  'Agendado',
  'Agendamento',
  'Programado',
  'Cancelado',
  'Estornado',
  'Recusado',
  'Negado',
  'Não transferido',
  'Não foi transferido',
  'Não transferida',
  'Não foi realizado',
  'Não autorizado',
  'Não aprovado',
  'Pix em andamento',
  'Pendente',
  'Em processamento',
  'Em análise',
  'Aguardando',
  'Não foi possível',
  'Falha',
]) {
  for (const text of [`${status}\n${fixture()}`, `${fixture()}\n${status}`]) {
    const reading = extractReceiptDocument(text);
    assert.equal(reading.details.blocked, true, status);
    assert.notEqual(reading.details.state, 'completed', status);
    assert.equal(income(reading), 0, status);
    assert.equal(needsReceiptOcrEnrichment(reading), true, status);
    assert.equal(
      preferReceiptReading([complete, reading]).details.blocked,
      true,
      status,
    );
  }
}

// Repeating a complete receipt/ID is not evidence for two payments. Conflicting
// OCR identifiers remain reviewable; stopping unnecessary enrichment does not
// relax the merge or choose between conflicting S/5 identifiers.
for (const text of [
  fixture() + '\n' + id,
  fixture() + '\n' + alternateId,
  fixture() + '\n' + fixture(),
]) {
  const reading = extractReceiptDocument(text);
  assert.equal(reading.details.ambiguous, true);
  assert.equal(income(reading), 0);
}
assert.equal(
  preferReceiptReading([complete, extractReceiptDocument(fixture(alternateId))])
    .details.ambiguous,
  true,
);
assert.equal(
  needsReceiptOcrEnrichment(
    preferReceiptReading([
      complete,
      extractReceiptDocument(fixture(alternateId)),
    ]),
  ),
  true,
  'An already observed identifier conflict cannot become trusted evidence',
);
assert.equal(
  preferReceiptReading([
    complete,
    extractReceiptDocument(fixture().replace('7.300,00', '7.800,00')),
  ]).details.ambiguous,
  true,
);
console.log(
  'PASS: Sicoob completion, split participant labels, transfer timestamp, blocked wording and duplicate safeguards.',
);
