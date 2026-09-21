import assert from 'node:assert/strict';
import {
  extractReceiptDocument,
  needsReceiptOcrEnrichment,
  preferReceiptReading,
  shortReceiptDate,
} from '../lib/receipt-document.ts';
import { identifiedReceiptDate } from '../lib/financial-report.ts';
import { saleReceiptIncome } from '../lib/receipt-income.ts';
import { receiptNoticeSentence } from '../lib/receipt-reading-notices.ts';

// Two OCR layouts from the supplied Nubank model, with synthetic identities.
const id = `E${'1'.repeat(31)}`;
const fixture = (stamp = '18 SET 2026 - 12:50:32') => `
Comprovante de transferência
${stamp}
Valor R$ 7.145,00
Tipo de transferência Pix
Destino
Nome LOJA DE TESTE LTDA
CNPJ 12345678000199
Instituição MT IP S.A.
Chave Pix
00000000-0000-0000-0000-000000000001
Origem
Nome PESSOA DE TESTE
Instituição NU PAGAMENTOS - IP
CPF ***.123.456-**
Nu Pagamentos S.A. - Instituição de Pagamento
CNPJ 18.236.120/0001-58
1D da transação:
${id}
Estamos aqui para ajudar se você tiver alguma dúvida.
Ouvidoria: 0800 887 0463
nubank.com.br/contato
`;
const complete = extractReceiptDocument(fixture());
assert.equal(complete.amountCents, 714500);
assert.equal(complete.details.paidAtText, '18 SET 2026 - 12:50:32');
assert.equal(
  shortReceiptDate(complete.details.paidAtText),
  '18/09/2026 · 12:50',
);
assert.deepEqual(identifiedReceiptDate(complete.details.paidAtText), {
  date: '18/09/2026',
  time: '12:50',
  dateKey: '2026-09-18',
});
assert.equal(complete.details.payerName, 'PESSOA DE TESTE');
assert.equal(complete.details.payerBank, 'NU PAGAMENTOS - IP');
assert.equal(complete.details.recipientName, 'LOJA DE TESTE LTDA');
assert.equal(complete.details.recipientBank, 'MT IP S.A.');
assert.equal(complete.details.recipientDocument, '12345678000199');
assert.equal(complete.details.transactionId, id);
assert.equal(complete.details.ambiguous, false);
assert.equal(complete.details.automaticEligible, true);
assert.equal(
  needsReceiptOcrEnrichment(complete),
  false,
  'a complete column-layout reading must not trigger another ID-changing OCR pass',
);

const stacked = extractReceiptDocument(
  fixture().replace(/^(Nome|CNPJ|CPF|Instituição) (.+)$/gm, '$1\n$2'),
);
assert.deepEqual(stacked.details, complete.details);
assert.equal(
  preferReceiptReading([complete, stacked]).details.ambiguous,
  false,
);
const income = saleReceiptIncome({
  productsTotalCents: 714500,
  payments: [],
  receipts: [
    {
      receiptAmountCents: complete.amountCents,
      receiptDetails: complete.details,
    },
  ],
});
assert.equal(income.receivedTotalCents, 714500);
assert.equal(income.receivedDifferenceCents, 0);

for (const separator of [' - ', ' – ', ' — ', ', ', ' ', '\n', ' às ']) {
  const result = extractReceiptDocument(
    fixture(`18 SET 2026${separator}12:50:32`),
  );
  assert.equal(
    shortReceiptDate(result.details.paidAtText),
    '18/09/2026 · 12:50',
  );
}
assert.equal(
  extractReceiptDocument(fixture('18 SET 2026')).details.paidAtText,
  null,
  'do not invent an absent transaction time',
);
const noDate = extractReceiptDocument(fixture(''));
assert.equal(noDate.details.paidAtText, null);

for (const suffix of ['Pix agendado', 'Cancelado', 'Em processamento'])
  assert.equal(
    extractReceiptDocument(fixture() + suffix).details.automaticEligible,
    false,
  );
for (const text of [
  fixture().replace(id, `E${'2'.repeat(31)}`),
  fixture().replace('7.145,00', '7.146,00'),
]) {
  const conflict = preferReceiptReading([
    complete,
    extractReceiptDocument(text),
  ]);
  assert.equal(conflict.details.ambiguous, true);
  assert.equal(conflict.details.automaticEligible, false);
}
assert.equal(
  extractReceiptDocument(
    fixture() + `\nID da transação: ${`E${'2'.repeat(31)}`}`,
  ).details.ambiguous,
  true,
);
assert.equal(
  receiptNoticeSentence({
    key: 'reading_ambiguous',
    label: 'Leitura ambígua',
    tone: 'blocking',
  }),
  'Leituras divergentes; confira o valor e o identificador Pix.',
);
console.log(
  'PASS: Nubank date/time, inline and stacked fields, first-pass acceptance, payment amount and conflict safeguards.',
);
