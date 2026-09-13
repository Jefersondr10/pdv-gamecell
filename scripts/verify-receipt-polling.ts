import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hasPendingReceiptWork,
  maximumReceiptPollRequestsPerHour,
  receiptSalePollDelay,
  receiptPollingBudgetPerHour,
  RECEIPT_ACTIVITY_IDLE_POLL_MS,
  RECEIPT_SALE_BURST_POLL_MS,
  RECEIPT_SALE_BURST_WINDOW_MS,
  RECEIPT_SALE_IDLE_POLL_MS,
  RECEIPT_SALE_PENDING_POLL_MS,
  type ReceiptSalePollingState,
} from '../lib/receipt-polling.ts';

assert.ok(
  maximumReceiptPollRequestsPerHour(true) <= 150,
  'one active sale must stay well below the 600 request/hour store limit',
);
assert.equal(maximumReceiptPollRequestsPerHour(false), 60);
assert.deepEqual(receiptPollingBudgetPerHour(1), {
  requests: 90,
  weightedUnits: 120,
});
assert.deepEqual(
  receiptPollingBudgetPerHour(4),
  { requests: 180, weightedUnits: 300 },
  'four simultaneous sale screens must leave at least half the budget free',
);
assert.ok(RECEIPT_ACTIVITY_IDLE_POLL_MS >= 120_000);
assert.ok(RECEIPT_SALE_IDLE_POLL_MS >= 120_000);

const terminal: ReceiptSalePollingState = {
  receipts: [
    {
      id: 'receipt',
      amountCents: 100,
      source: 'ocr',
      status: 'completed',
      updatedAt: 1,
      confirmedAt: 1,
      generation: 1,
    },
  ],
  payment: {
    status: 'applied',
    requestId: 'request',
    saleStatus: 'completed',
    complete: true,
    receivedTotalCents: 100,
    receiptTotalCents: 100,
    payments: [],
    expectedPayments: '[]',
    expectedReceipts: '[]',
  },
};
assert.equal(hasPendingReceiptWork(terminal), false);
assert.equal(
  receiptSalePollDelay(terminal, RECEIPT_SALE_BURST_WINDOW_MS, 0),
  RECEIPT_SALE_BURST_POLL_MS,
  'a recent upload or reread should temporarily refresh the sale quickly',
);
assert.equal(
  receiptSalePollDelay(
    terminal,
    RECEIPT_SALE_BURST_WINDOW_MS,
    RECEIPT_SALE_BURST_WINDOW_MS,
  ),
  RECEIPT_SALE_IDLE_POLL_MS,
  'a completed sale should return to idle polling after the burst',
);
assert.equal(
  hasPendingReceiptWork({
    ...terminal,
    payment: { ...terminal.payment, status: 'pending' },
  }),
  true,
);
assert.equal(
  receiptSalePollDelay(
    {
      ...terminal,
      payment: { ...terminal.payment, status: 'pending' },
    },
    0,
    RECEIPT_SALE_BURST_WINDOW_MS,
  ),
  RECEIPT_SALE_PENDING_POLL_MS,
  'pending work should retain the existing economical interval outside the burst',
);
assert.equal(
  hasPendingReceiptWork({
    ...terminal,
    receipts: [{ ...terminal.receipts[0], status: 'retry' }],
  }),
  true,
);

const runtime = readFileSync(
  'components/pdv/server-receipt-runtime.tsx',
  'utf8',
);
const paymentView = readFileSync(
  'components/pdv/receipt-payment-sync.tsx',
  'utf8',
);
const combinedRoute = readFileSync(
  'app/api/sales/[id]/receipt-ocr/route.ts',
  'utf8',
);
assert.equal(
  (runtime.match(/\/api\/sales\/\$\{saleId\}\/receipt-ocr/g) ?? []).length,
  2,
  'the combined sale endpoint should be used once for GET and once for retry POST',
);
assert.ok(!runtime.includes(`/receipt-payment`));
assert.ok(!paymentView.includes('requestJson'));
assert.ok(
  runtime.includes('snapshot && snapshot.saleId === saleId'),
  'a previous sale snapshot must never be rendered for the next sale',
);
assert.ok(
  combinedRoute.includes("const includePayment = can(session, 'sales')"),
);
assert.ok(combinedRoute.includes('publicReceiptPaymentState(payment)'));
assert.ok(
  runtime.includes('pdv:receipt-activity:') &&
    runtime.includes("window.addEventListener('storage'"),
  'store activity polling should be shared between browser tabs',
);
assert.ok(
  runtime.includes(
    'burstUntil.current = Date.now() + RECEIPT_SALE_BURST_WINDOW_MS',
  ) && runtime.includes('receiptSalePollDelay(result, burstUntil.current)'),
  'upload and reread events should activate temporary fast sale polling',
);

console.log(
  'Receipt polling passed: combined state, shared activity and 120 weighted units/hour per active screen.',
);
