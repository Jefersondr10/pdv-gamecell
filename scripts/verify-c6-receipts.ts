import assert from 'node:assert/strict';
import {
  extractReceiptDocument,
  needsReceiptOcrEnrichment,
  parseReceiptDocument,
  preferReceiptReading,
} from '../lib/receipt-document.ts';
import { receiptIncomeCents } from '../lib/receipt-income.ts';

// Synthetic names, account and identifiers; no customer receipt is committed.
const body = `Loja fictícia
Banco: 999 - Banco recebedor de teste
Agência: ***1
Código de autenticação
AUTHENTICATIONTEST
ID da Transação
E0000000000000000000000000000001
Chave
00000000-0000-0000-0000-000000000001
CPF / CNPJ
12.345.678/0001-99
Valor
R$ 13.940,00
Data e horário da transação
sábado, 12 de setembro de 2026, 15:55
Conta de origem
Cliente fictício
Banco: 336 - Banco C6 S.A.
Agência: ***1
Conta: ***1
SAC (reclamações, cancelamentos, dúvidas)`;
const timestamp = '12/09/2026 12/09/2026\n15:55 15:55';
const receipt = (heading: string, extra = '') =>
  `C6BANK\n${heading}\n${timestamp}\n${body}\n${extra}`;
const income = (text: string) => {
  const result = extractReceiptDocument(text);
  return receiptIncomeCents({
    receiptAmountCents: result.amountCents,
    receiptDetails: result.details,
  });
};

for (const heading of [
  'Pix em Pix\nandamento realizado!',
  'ixem px\nandamento realizado!',
  'Pixem\nPix\nandamento\nrealizado!',
]) {
  const text = receipt(heading);
  const result = extractReceiptDocument(text);
  assert.equal(income(text), 1394000, heading);
  assert.equal(result.details.automaticEligible, true, heading);
  assert.equal(result.details.recipientName, 'Loja fictícia');
  assert.equal(result.details.recipientBank, '999 - Banco recebedor de teste');
  assert.equal(result.details.recipientDocument, '12345678000199');
  assert.equal(result.details.payerName, 'Cliente fictício');
  assert.equal(result.details.payerBank, '336 - Banco C6 S.A.');
}
const sequential = `C6BANK\nPix em andamento\n12/09/2026 15:54\nPix realizado!\n12/09/2026 15:55\n${body}`;
assert.equal(income(sequential), 1394000);
const compactClock = receipt('Pix em Pix\nandamento realizado!').replace(
  timestamp,
  '09/09/2026 09/09/2026\n1818 1818',
);
assert.equal(income(compactClock), 1394000);
// Missing/cropped timeline or participant metadata is now informational. A
// unique amount still counts when no explicit negative state was recognized.
for (const [index, text] of [
  receipt('Pix em Pix\nandamento realizado!').replace(
    timestamp,
    '12/09/2026\n15:55',
  ),
  receipt('Pix em Pix\nandamento realizado!').replace(
    timestamp,
    '12/09/2026 12/09/2026\n15:55',
  ),
  receipt('Pix em Pix\nandamento realizado!').replace(
    'Banco C6',
    'Banco diferente',
  ),
  receipt('Pix em Pix\nandamento realizado!').replace(
    'Loja fictícia\nBanco: 999 - Banco recebedor de teste\n',
    '',
  ),
  receipt('Pix em Pix\nandamento realizado!').replace(
    timestamp,
    'Data da consulta\n' + timestamp,
  ),
].entries())
  assert.equal(income(text), 1394000, `sparse ${index}`);
for (const [index, text] of [
  receipt('Pix em andamento'),
  receipt('Pixem\nandamento'),
  receipt('Pix em Pix\nandamento não realizado!'),
  receipt('Pix em andamento', 'Nome do destinatário: Pix realizado!'),
  ...[
    'Agendado',
    'Cancelado',
    'Estornado',
    'Em processamento',
    'Pendente',
    'Não foi efetuado',
    'Pix em andamento',
  ].map((status) => receipt('Pix em Pix\nandamento realizado!', status)),
  sequential + '\nSituação atual: Pix em andamento',
  receipt('Pix em Pix\nandamento realizado!').replace(
    'Loja fictícia',
    'Situação atual: Pix em andamento\nLoja fictícia',
  ),
  sequential.replace(
    'Loja fictícia',
    'Situação atual: Pix em andamento\nLoja fictícia',
  ),
  'Situação atual: Pix em andamento\n' + sequential,
  sequential.replace(
    'Pix realizado!\n12/09/2026',
    'Pix realizado!\nData da consulta 12/09/2026',
  ),
].entries())
  assert.equal(
    income(text),
    0,
    `${index}: ${text.split('\n').slice(0, 7).join(' ')}`,
  );

const completed = extractReceiptDocument(
  receipt('Pixem Pix\nandamento realizado!'),
);
const garbageBank = extractReceiptDocument(
  receipt('Pixem Pix\nandamento realizado!').replace(
    'Banco: 999 - Banco recebedor de teste',
    'Banco: és',
  ),
);
assert.equal(garbageBank.details.recipientBank, null);
assert.equal(needsReceiptOcrEnrichment(garbageBank), true);
const plausibleSecondReading = {
  ...completed,
  details: {
    ...completed.details,
    automaticEligible: false,
    transactionId: null,
  },
};
const sparseEligible = extractReceiptDocument(
  receipt('Pixem Pix\nandamento realizado!')
    .replace('Banco: 999 - Banco recebedor de teste', 'Banco: és')
    .replace('\nValor\nR$ 13.940,00', '\nR$ 13.940,00'),
);
assert.equal(sparseEligible.details.recipientBank, null);
assert.equal(sparseEligible.details.automaticEligible, true);
const realPatternPreferred = preferReceiptReading([
  plausibleSecondReading,
  sparseEligible,
]);
assert.equal(realPatternPreferred.amountCents, 1394000);
assert.equal(realPatternPreferred.details.automaticEligible, true);
assert.equal(
  realPatternPreferred.details.transactionId,
  sparseEligible.details.transactionId,
);
assert.equal(
  realPatternPreferred.details.recipientBank,
  '999 - Banco recebedor de teste',
);
assert.equal(
  preferReceiptReading([garbageBank, plausibleSecondReading]).details
    .recipientBank,
  '999 - Banco recebedor de teste',
);
const enriched = preferReceiptReading([garbageBank, plausibleSecondReading]);
assert.equal(enriched.details.automaticEligible, true);
assert.equal(
  enriched.details.transactionId,
  garbageBank.details.transactionId,
  'bank enrichment must preserve the eligible reading transaction id',
);
const otherAmount = {
  ...extractReceiptDocument(
    receipt('Pixem Pix\nandamento realizado!').replace(
      'R$ 13.940,00',
      'R$ 14.940,00',
    ),
  ),
  details: {
    ...completed.details,
    automaticEligible: false,
    transactionId: null,
  },
};
const amountConflict = preferReceiptReading([garbageBank, otherAmount]);
assert.equal(amountConflict.details.recipientBank, null);
assert.equal(amountConflict.details.ambiguous, true);
assert.equal(amountConflict.details.automaticEligible, false);
const otherRecipientReading = extractReceiptDocument(
  receipt('Pixem Pix\nandamento realizado!')
    .replace('Loja fictícia', 'Outro recebedor')
    .replace('12.345.678/0001-99', '98.765.432/0001-10'),
);
const otherRecipient = {
  ...otherRecipientReading,
  details: {
    ...otherRecipientReading.details,
    automaticEligible: false,
    transactionId: null,
  },
};
const recipientConflict = preferReceiptReading([garbageBank, otherRecipient]);
assert.equal(recipientConflict.details.recipientBank, null);
assert.equal(recipientConflict.details.automaticEligible, true);
const shortC6 = extractReceiptDocument(
  receipt('Pixem Pix\nandamento realizado!').replace(
    'Banco: 999 - Banco recebedor de teste',
    'Banco: C6',
  ),
);
assert.equal(shortC6.details.recipientBank, 'C6');
const corruptedIdLabel = extractReceiptDocument(
  receipt('Pixem Pix\nandamento realizado!').replace(
    'ID da Transação',
    'ID ca Transação',
  ),
);
assert.equal(corruptedIdLabel.details.automaticEligible, true);
assert.equal(
  corruptedIdLabel.details.transactionId,
  'E0000000000000000000000000000001',
);
const lowResolutionC6 = extractReceiptDocument(
  receipt('Pixem Pix\nandamento realizado!')
    .replace('ID da Transação', 'ID ca Transação')
    .replace('Banco C6 S.A.', 'Banco Có SA.')
    .replace(timestamp, '12/09/2026 12/09/2026\n15:55, 15:55'),
);
assert.equal(lowResolutionC6.details.automaticEligible, true);
assert.equal(lowResolutionC6.details.payerBank, '336 - Banco Có SA.');
const croppedBankSuffix = extractReceiptDocument(
  receipt('Pixem Pix\nandamento realizado!').replace(
    'Banco C6 S.A.',
    'Banco C6',
  ),
);
assert.equal(croppedBankSuffix.details.automaticEligible, true);
assert.equal(
  parseReceiptDocument({ ...completed.details, recipientBank: 'és' })
    ?.recipientBank,
  null,
);
const blocked = extractReceiptDocument(receipt('Pix em andamento'));
assert.equal(preferReceiptReading([completed, blocked]).details.blocked, true);
const conflicting = extractReceiptDocument(
  receipt('Pixem Pix\nandamento realizado!').replace('13.940,00', '14.940,00'),
);
assert.equal(
  preferReceiptReading([completed, conflicting]).details.ambiguous,
  true,
);
console.log(
  'PASS: C6 completed timeline, receiver/payer separation, pending/future/contradictory timelines and OCR conflicts.',
);
