import assert from 'node:assert/strict';

import { deriveReceiptReconciliation } from '../lib/receipt-reconciliation.ts';
import { saleDisplayStatus } from '../lib/sale-display-status.ts';

const reconciledSale = {
  status: 'completed' as const,
  orderStatus: null,
  productsTotalCents: 100,
  receivedTotalCents: 100,
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
  'missing_receipt',
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
  status: 'pending',
  confirmedTotalCents: 50_000,
  differenceCents: null,
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
