import assert from 'node:assert/strict';

import { deriveReceiptReconciliation } from '../lib/receipt-reconciliation.ts';
import { saleDisplayStatus } from '../lib/sale-display-status.ts';
import type { ReceiptDocument } from '../lib/receipt-document.ts';

const reconciledSale = {
  status: 'completed' as const,
  orderStatus: null,
  productsTotalCents: 100,
  receivedTotalCents: 100,
  payments: [{ method: 'pix', amountCents: 100 }],
  items: [{ soldPriceCents: 100, photos: [{}] }],
  receipts: [{ receiptAmountCents: 100 }],
  reconciliation: deriveReceiptReconciliation([{ amountCents: 100 }], 100),
};
assert.equal(saleDisplayStatus(reconciledSale).label, 'Conciliado');
assert.equal(
  saleDisplayStatus({ ...reconciledSale, status: 'cancelled' }).label,
  'Cancelado',
);
assert.equal(
  saleDisplayStatus({
    ...reconciledSale,
    receipts: [],
    reconciliation: deriveReceiptReconciliation([], 100),
  }).key,
  'none',
);

assert.deepEqual(deriveReceiptReconciliation([], 620_000), {
  status: 'pending',
  confirmedTotalCents: 0,
  differenceCents: null,
  pendingReceiptCount: 1,
});

assert.deepEqual(
  deriveReceiptReconciliation(
    [{ amountCents: 500_000 }, { amountCents: 120_000 }],
    620_000,
  ),
  {
    status: 'reconciled',
    confirmedTotalCents: 620_000,
    differenceCents: 0,
    pendingReceiptCount: 0,
  },
);

assert.deepEqual(
  deriveReceiptReconciliation(
    [{ amountCents: 500_000 }, { amountCents: 100_000 }],
    620_000,
  ),
  {
    status: 'divergent',
    confirmedTotalCents: 600_000,
    differenceCents: -20_000,
    pendingReceiptCount: 0,
  },
);

assert.deepEqual(
  deriveReceiptReconciliation([{ receiptAmountCents: 650_000 }], 620_000),
  {
    status: 'divergent',
    confirmedTotalCents: 650_000,
    differenceCents: 30_000,
    pendingReceiptCount: 0,
  },
);

assert.deepEqual(
  deriveReceiptReconciliation(
    [{ amountCents: 620_000 }, { amountCents: null }],
    620_000,
  ),
  {
    status: 'pending',
    confirmedTotalCents: 620_000,
    differenceCents: null,
    pendingReceiptCount: 1,
  },
);

assert.deepEqual(deriveReceiptReconciliation([{ amountCents: 50_000 }], 0), {
  status: 'divergent',
  confirmedTotalCents: 50_000,
  differenceCents: 50_000,
  pendingReceiptCount: 0,
});

console.log('Receipt reconciliation checks passed.');

for (const amountCents of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  const invalid = deriveReceiptReconciliation(
    [{ amountCents: 100 }, { amountCents }],
    100,
  );
  assert.equal(
    invalid.status,
    'pending',
    'Invalid receipts cannot complete reconciliation',
  );
  assert.equal(invalid.confirmedTotalCents, 100);
  assert.equal(invalid.pendingReceiptCount, 1);
}

const document: ReceiptDocument = {
  version: 1,
  state: 'completed',
  automaticEligible: true,
  blocked: false,
  ambiguous: false,
  payerName: null,
  payerBank: null,
  recipientName: null,
  recipientBank: null,
  recipientDocument: null,
  transactionId: 'E0000000000000000000000000000001',
  alternateTransactionId: null,
  observedTransactionId: null,
  paidAtText: null,
};
for (const receiptDetails of [
  { ...document, blocked: true },
  { ...document, ambiguous: true },
  ...(['scheduled', 'cancelled'] as const).map((state) => ({
    ...document,
    state,
  })),
]) {
  const result = deriveReceiptReconciliation(
    [{ receiptAmountCents: 100 }, { receiptAmountCents: 200, receiptDetails }],
    300,
  );
  assert.deepEqual(
    result,
    {
      status: 'pending',
      confirmedTotalCents: 100,
      differenceCents: null,
      pendingReceiptCount: 1,
      reviewReceiptCount: 1,
    },
    'unconfirmed documents are neither credited nor reconciled',
  );
}
assert.deepEqual(
  deriveReceiptReconciliation(
    [
      { receiptAmountCents: 100 },
      {
        receiptAmountCents: 200,
        receiptDetails: { ...document, state: 'unknown' },
      },
    ],
    300,
  ),
  {
    status: 'reconciled',
    confirmedTotalCents: 300,
    differenceCents: 0,
    pendingReceiptCount: 0,
  },
  'a unique eligible amount remains usable when the completion phrase is absent',
);
assert.equal(
  deriveReceiptReconciliation(
    [{ receiptAmountCents: 300, receiptDetails: document }],
    300,
  ).status,
  'reconciled',
);
assert.equal(
  deriveReceiptReconciliation(
    [{ receiptAmountCents: 300, receiptDetails: null }],
    300,
  ).status,
  'reconciled',
  'legacy receipts remain supported',
);
