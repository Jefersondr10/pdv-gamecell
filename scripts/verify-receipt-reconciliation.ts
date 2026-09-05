import assert from 'node:assert/strict';

import { deriveReceiptReconciliation } from '../lib/receipt-reconciliation.ts';

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
  status: 'pending',
  confirmedTotalCents: 50_000,
  differenceCents: null,
  pendingReceiptCount: 0,
});

console.log('Receipt reconciliation checks passed.');
