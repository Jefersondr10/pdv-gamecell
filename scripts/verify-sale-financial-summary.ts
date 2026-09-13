import assert from 'node:assert/strict';
import { saleFinancialSummary } from '../lib/sale-financial-summary.ts';
import { deriveReceiptReconciliation } from '../lib/receipt-reconciliation.ts';

const fixture = (
  amounts: (number | null)[],
  paid = 3473000,
  cancelled = false,
) => {
  const receipts = amounts.map((receiptAmountCents) => ({
    receiptAmountCents,
  }));
  return {
    status: cancelled ? ('cancelled' as const) : ('completed' as const),
    productsTotalCents: 3473000,
    receivedTotalCents: paid,
    payments: [{ method: 'pix', amountCents: paid }],
    items: [{ soldPriceCents: 3473000, photos: [{}] }],
    receipts,
    reconciliation: deriveReceiptReconciliation(receipts, 3473000),
  };
};
const actual = fixture([1500000, 1965000]);
const original = JSON.stringify(actual);
const below = saleFinancialSummary(actual);
assert.equal(below.reconciled, false);
assert.match(below.paymentLabel, /Recebido.*34\.650,00/);
assert.equal(below.receiptDifferenceCents, -8000);
assert.match(below.receiptText!, /34\.650,00.*80,00 abaixo do valor da venda/);
assert.equal(below.receiptWarning, true);
assert.equal(
  JSON.stringify(actual),
  original,
  'Presentation never edits payments',
);
const equal = saleFinancialSummary(fixture([3473000]));
assert.equal(equal.reconciled, true);
assert.equal(equal.paymentLabel, 'Venda / pago');
assert.equal(equal.receiptWarning, false);
const above = saleFinancialSummary(fixture([3481000]));
assert.equal(above.reconciled, false);
assert.match(above.receiptText!, /80,00 acima do valor da venda/);
for (const receipts of [[], [null], [1500000, null], [0], [-1]]) {
  const pending = saleFinancialSummary(fixture(receipts));
  assert.equal(pending.reconciled, false);
  assert.equal(
    pending.receiptText,
    null,
    'Never call a partial amount the total',
  );
  assert.equal(pending.receiptTotalCents, null);
}
const staleTypedPix = saleFinancialSummary(fixture([3473000], 3472000));
assert.equal(staleTypedPix.reconciled, true);
assert.equal(staleTypedPix.paymentLabel, 'Venda / pago');
assert.equal(staleTypedPix.pixCents, 3473000);
const missingPhoto = fixture([3473000]);
missingPhoto.items[0].photos = [];
assert.equal(saleFinancialSummary(missingPhoto).reconciled, false);
const cancelled = saleFinancialSummary(
  fixture([1500000, 1965000], 3473000, true),
);
assert.equal(cancelled.reconciled, false);
assert.equal(cancelled.receiptText, null);
assert.equal(cancelled.paymentLabel, 'Venda cancelada');
console.log(
  'Sale amounts, document differences and reconciliation display verified.',
);
