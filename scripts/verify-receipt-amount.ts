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
  extractReceiptAmount(
    'Valor\nda\ntransação\nR$ 500,00\nSaldo\nR$ 9.000,00',
  )?.amountCents,
  50_000,
);

console.log('Receipt amount extraction checks passed.');
