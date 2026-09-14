import assert from 'node:assert/strict';

import { extractReceiptAmount } from '../lib/receipt-amount.ts';

assert.equal(
  extractReceiptAmount(
    'Pix realizado\nValor da transação\nR$ 6.200,00\nSaldo R$ 9.821,44',
  )?.amountCents,
  620_000,
);
assert.equal(
  extractReceiptAmount(
    'Transferência realizada\nValor transferido 500,00\nTarifa 0,00',
  )?.amountCents,
  50_000,
);
assert.equal(
  extractReceiptAmount('Saldo disponível R$ 12.345,67\nDocumento 123456')
    ?.amountCents ?? null,
  null,
);
assert.equal(extractReceiptAmount('Sem valor monetário'), null);
assert.equal(
  extractReceiptAmount('Valor\nda\ntransação\nR$ 500,00\nSaldo\nR$ 9.000,00')
    ?.amountCents,
  50_000,
);

for (const [text, amount] of [
  ['R$ 19.650', 1_965_000],
  ['R$ 15.000', 1_500_000],
  ['RS 15.000', 1_500_000],
  ['R$19.650,00', 1_965_000],
  ['R$ 19650', 1_965_000],
  ['R$ 19 650', 1_965_000],
  ['R$ 19\u00a0650', 1_965_000],
  ['R$ 19\u202f650', 1_965_000],
  ['R$ 19.65', 1_965],
  ['R$ 19,65', 1_965],
  ['R$ 15', 1_500],
  ['R$ 1.234.567', 123_456_700],
  ['R$ 1,234.56', 123_456],
  ['Valor transferido 19.650', 1_965_000],
  ['Valor R$19.650\nSaldo R$20.000', 1_965_000],
  ['Valor da transação R$ 19.650 09/09/2026', 1_965_000],
  ['Valor da transação R$ 15.000 15:30', 1_500_000],
  ['Valor da transação R$ 15.000 123', 1_500_000],
  ['Valor da transação R$ 15.000 Saldo R$ 20.000', 1_500_000],
  ['Valor transferido R$500,00 Tarifa R$0,00', 50000],
  [
    'Comprovante de Pix\n8/setembro/2026 às 17:54:50.\nR$ 19.650\nOrigem e destino\nCNPJ: 64.947.925/0001-27\nN.º transação do Mercado Pago\n177978509808\nFaça Pix\nR$ 50 para Ana',
    1_965_000,
  ],
  [
    'Comprovante de Pix\n8/setembro/2026 às 17:51:29.\nR$ 15.000\nPagamento fornec\nCNPJ: 61.120.555/0001-61\nID de transação Pix\nE10573521202609082051a4daXPDZcCD',
    1_500_000,
  ],
  [
    'Comprovante de Pix\nValor da transação\nR$ 1.000,00\nPix realizado\nValor máximo por Pix: R$ 20.000,00',
    100_000,
  ],
  [
    'Comprovante de Pix\nValor da transação\nR$ 1.000,00\nPix realizado\nTotal da sua fatura R$ 2.000,00',
    100_000,
  ],
  [
    'Comprovante de Pix\nValor da transação\nR$ 1.000,00\nPix realizado\nValor máximo por Pix: 20.000,00',
    100_000,
  ],
] as const)
  assert.equal(extractReceiptAmount(text)?.amountCents, amount, text);
for (const text of [
  'R$ 19.6500',
  'R$15.0000',
  'R$ 12.34.567',
  'R$ 1 23 456',
  'R$ 1.234,567',
  'R$ 10.000.000,01',
  'Saldo R$19.650',
  'Limite disponível R$15.000',
  'Valor da transação\nCPF 123.456.789-00',
  'Valor da transação\nCNPJ 12.345.678/0001-90',
  'Valor da transação\n09/09/2026',
  'Valor da transação\n15:00',
  'Valor da transação\nTelefone (11) 99999-9999',
  'Valor da transação (11) 99999-9999',
  'R$ 19 6500',
  'R$ 19 650 0000',
  'Valor da transação\nDocumento 001923456789',
  'Código da transação 123.456.789',
  'ID da transação 123.456.789',
  'Valor da transação\nChave Pix 123.456.789-00',
  'Valor da transação\nLinha digitável 12345.67',
  'Valor da transação\nABC123.45XYZ',
])
  assert.equal(extractReceiptAmount(text), null, text);
console.log(
  'PASS: receipt integer thousands, decimals, full tokens and identifier rejection.',
);
