import assert from 'node:assert/strict';
import {
  extractReceiptDocument,
  parseReceiptDocument,
} from '../lib/receipt-document.ts';

const receiptText = (payer: string, recipient: string) =>
  `Comprovante de Pix\n8/setembro/2026 às 17:51:29\nR$ 15.000\nOrigem e destino\n${payer}\nMercado Pago\nCNPJ: 11111111000191\n${recipient}\nMT INSTITUICAO DE PAGAMENTO SA\nCNPJ: 22222222000191\nID de transação Pix\nE${'1'.repeat(31)}`;

const clean = extractReceiptDocument(
  receiptText('LOJA EXEMPLO LTDA.-', 'Empresa de teste Ltd'),
);
for (const prefix of ['& ', '<& ', '< & ', '&& ', '• ', '&']) {
  const reading = extractReceiptDocument(
    receiptText(
      `${prefix}LOJA EXEMPLO LTDA.-`,
      `${prefix}Empresa de teste Ltd`,
    ),
  );
  assert.deepEqual(
    reading,
    clean,
    `Only leading OCR symbols change: ${prefix}`,
  );
}

const legitimate = extractReceiptDocument(
  receiptText('A & B Importações LTDA', "D'Ávila & Filhos Ltda"),
);
assert.equal(legitimate.details.payerName, 'A & B Importações LTDA');
assert.equal(legitimate.details.recipientName, "D'Ávila & Filhos Ltda");
assert.equal(clean.amountCents, 1_500_000);

const saved = {
  ...clean.details,
  payerName: '<& LOJA EXEMPLO LTDA.-',
  recipientName: '& Empresa de teste Ltd',
};
const snapshot = JSON.stringify(saved);
assert.deepEqual(parseReceiptDocument(saved), clean.details);
assert.deepEqual(parseReceiptDocument(snapshot), clean.details);
assert.equal(JSON.stringify(saved), snapshot, 'Saved source remains unchanged');
assert.deepEqual(parseReceiptDocument(legitimate.details), legitimate.details);
assert.equal(
  parseReceiptDocument({ ...saved, payerName: null })?.payerName,
  null,
);
assert.equal(parseReceiptDocument({ ...saved, payerName: 123 }), null);
assert.equal(
  parseReceiptDocument({ ...saved, payerName: 'A'.repeat(151) }),
  null,
);
assert.equal(
  parseReceiptDocument(parseReceiptDocument(saved))?.payerName,
  clean.details.payerName,
);
console.log(
  'Participant OCR prefixes cleaned; internal ampersands, payment data and saved source preserved.',
);
