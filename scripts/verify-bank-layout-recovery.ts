import assert from 'node:assert/strict';
import {
  extractReceiptDocument,
  needsReceiptOcrEnrichment,
  preferReceiptReading,
  shortReceiptDate,
} from '../lib/receipt-document.ts';
import { saleReceiptIncome } from '../lib/receipt-income.ts';
import { identifiedReceiptDate } from '../lib/financial-report.ts';

// Layout-only fixtures: no customer identities or live transaction IDs.
const id = `E${'1'.repeat(31)}`;
const stone = `Comprovante de transferência
Realizada em 09 set 2026 às 15:36:01 stone
Valor Tipo
R$ 4.100,00 Pix | Transferência
DADOS DE DESTINO
Nome CNPJ
LOJA DE TESTE LTDA 12.345.678/0001-99
Instituição
MT INSTITUICAO DE PAGAMENTO SA
DADOS DE ORIGEM
Nome CNPJ
CLIENTE DE TESTE LTDA 98.765.432/0001-00
Instituição Agência Conta
STONE INSTITUIÇÃO DE PAGAMENTO S.A. 0001 123456-7
INFORMAÇÕES ADICIONAIS
ID da transação Código da autenticação
${id} 00000000-0000-0000-0000-000000000001
`;
const bradesco = `Confirmação de Operação
Transferir
Data da operação: 12/09/2026 - 12h13
N° de controle: 111.111.111.111.111.111
Conta: Agência: 1234 | Conta: 123456-7
Empresa: CLIENTE DE TESTE LTDA
Dados de quem
recebeu
Nome: LOJA DE TESTE LTDA
CPF/CNPJ: 12.345.678/0001-99
Instituição Destino: MT IP S.A.
Chave: 00000000-0000-0000-0000-000000000001
Agência: 1
Conta: 12345-6
Dados da Transferência
Valor: R$ 19.920,00
Descrição:
Identificação: ${id}
Documento: 0
Debitado da: Conta poupanca
Instituição Origem: BANCO BRADESCO S.A.
Cancelamentos, Reclamações e Informações. Atendimento 24 horas.
`;
const inter = `Inter
Pix enviado
R$ 6.640,00
Sobre a transação
Data da transação Sábado, 12/09/2026
Horário 15h01
ID datransação | ${id}
Quem recebeu
Nome LOJA DE TESTE LTDA
CPF/CNPJ 12.345.678/0001-99
Instituição MT IP S.A.
Chave Pix 00000000-0000-0000-0000-000000000001
Quem pagou
Nome CLIENTE DE TESTE LTDA
CPF/CNPJ 98.765.432/0001-00
Instituição BANCO INTER
`;
const neon = `neon
Pix enviado
R$ 4.150,00
Ocorreu em 17 de setembro de 2026 às 15:20
Quem pagou
Nome CLIENTE DE TESTE LTDA
CPF/CNPJ ***.123.456-**
Instituição NEON PAGAMENTOS
Quem recebeu
Nome LOJA DE TESTE LTDA
CPF/CNPJ 12.345.678/0001-99
Instituição MT IP S.A.
`;
const cases = [
  {
    text: stone,
    amount: 410000,
    total: 710000,
    cash: 300000,
    date: '09/09/2026 · 15:36',
    bank: 'MT INSTITUICAO DE PAGAMENTO SA',
    payerBank: 'STONE INSTITUIÇÃO DE PAGAMENTO S.A.',
  },
  {
    text: bradesco,
    amount: 1992000,
    total: 1992000,
    cash: 0,
    date: '12/09/2026 · 12:13',
    bank: 'MT IP S.A.',
    payerBank: 'BANCO BRADESCO S.A.',
  },
  {
    text: inter,
    amount: 664000,
    total: 664000,
    cash: 0,
    date: '12/09/2026 · 15:01',
    bank: 'MT IP S.A.',
    payerBank: 'BANCO INTER',
  },
  {
    text: neon,
    amount: 415000,
    total: 730000,
    cash: 0,
    date: '17/09/2026 · 15:20',
    bank: 'MT IP S.A.',
    payerBank: 'NEON PAGAMENTOS',
  },
];
for (const c of cases) {
  const r = extractReceiptDocument(c.text);
  assert.equal(r.amountCents, c.amount);
  assert.equal(r.details.automaticEligible, true);
  assert.equal(r.details.ambiguous, false);
  assert.equal(r.details.recipientName, 'LOJA DE TESTE LTDA');
  assert.equal(r.details.payerName, 'CLIENTE DE TESTE LTDA');
  assert.equal(r.details.recipientBank, c.bank);
  assert.equal(r.details.payerBank, c.payerBank);
  assert.equal(r.details.recipientDocument, '12345678000199');
  assert.equal(shortReceiptDate(r.details.paidAtText), c.date);
  assert.equal(
    identifiedReceiptDate(r.details.paidAtText).time,
    c.date.slice(-5),
  );
  assert.equal(
    needsReceiptOcrEnrichment(r),
    false,
    'complete primary text must not require a second OCR pass',
  );
  if (c.text !== neon) assert.equal(r.details.transactionId, id);
  const income = saleReceiptIncome({
    productsTotalCents: c.total,
    payments: [{ method: 'cash', amountCents: c.cash }],
    receipts: [
      { receiptAmountCents: r.amountCents, receiptDetails: r.details },
    ],
  });
  assert.equal(income.receivedTotalCents, c.amount + c.cash);
  assert.equal(income.receivedDifferenceCents, c.amount + c.cash - c.total);
  for (const suffix of ['Pix agendado', 'Cancelado', 'Em processamento'])
    assert.equal(
      extractReceiptDocument(c.text + '\n' + suffix).details.automaticEligible,
      false,
    );
  assert.equal(
    extractReceiptDocument(c.text + '\nValor: R$ 123,45').details
      .automaticEligible,
    false,
  );
  if (c.text !== neon) {
    const different = extractReceiptDocument(
      c.text.replace(id, `E${'2'.repeat(31)}`),
    );
    assert.equal(
      preferReceiptReading([r, different]).details.automaticEligible,
      false,
    );
  }
}
const masked = extractReceiptDocument(
  bradesco
    .replace('12.345.678/0001-99', '***.123.456-**')
    .replace('MT IP S.A.', 'CCLA TESTE LTDA-SICOOB'),
);
assert.equal(masked.details.recipientDocument, null);
assert.equal(masked.details.recipientBank, 'CCLA TESTE LTDA-SICOOB');
assert.equal(masked.details.recipientAccount, '12345-6');
assert.equal(needsReceiptOcrEnrichment(masked), false);
assert.equal(
  extractReceiptDocument(inter.replace('Horário 15h01', '')).details.paidAtText,
  null,
);
assert.equal(
  extractReceiptDocument(neon.replace(' às 15:20', '')).details.paidAtText,
  null,
);
console.log(
  'PASS: Stone columns, Bradesco split headings and h-times, Inter labelled fields, Neon date, cash/partial totals and conflict safeguards.',
);
