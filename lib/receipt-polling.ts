import type { SalePaymentRecord } from './pdv-types.ts';

export const RECEIPT_ACTIVITY_IDLE_POLL_MS = 120_000;
export const RECEIPT_ACTIVITY_PENDING_POLL_MS = 60_000;
export const RECEIPT_SALE_IDLE_POLL_MS = 120_000;
export const RECEIPT_SALE_PENDING_POLL_MS = 120_000;
export const RECEIPT_SALE_BURST_POLL_MS = 3_000;
export const RECEIPT_SALE_BURST_WINDOW_MS = 30_000;
export const RECEIPT_POLL_RETRY_MS = 60_000;
export const RECEIPT_ACTIVITY_READ_COST = 1;
export const RECEIPT_SALE_READ_COST = 2;

export type ServerReceiptJob = {
  id: string;
  amountCents: number | null;
  source: 'ocr' | 'manual' | null;
  status: string | null;
  updatedAt: number | null;
  confirmedAt: number | null;
  generation: number | null;
};

export type ReceiptPaymentPollingState = {
  status: string;
  requestId: string | null;
  saleStatus: string;
  complete: boolean;
  receivedTotalCents: number;
  receiptTotalCents: number;
  payments: SalePaymentRecord[];
  expectedPayments: string;
  expectedReceipts: string;
};

export type ReceiptSalePollingState = {
  receipts: ServerReceiptJob[];
  payment: ReceiptPaymentPollingState;
};

export function hasPendingReceiptWork(state: ReceiptSalePollingState) {
  return (
    state.payment.status === 'pending' ||
    state.receipts.some(
      (receipt) =>
        (!receipt.status && receipt.amountCents === null) ||
        ['pending', 'processing', 'retry'].includes(receipt.status ?? ''),
    )
  );
}

export function receiptSalePollDelay(
  state: ReceiptSalePollingState,
  burstUntil: number,
  now = Date.now(),
) {
  if (now < burstUntil) return RECEIPT_SALE_BURST_POLL_MS;
  return hasPendingReceiptWork(state)
    ? RECEIPT_SALE_PENDING_POLL_MS
    : RECEIPT_SALE_IDLE_POLL_MS;
}

export function receiptPollingBudgetPerHour(openSaleDetails: number) {
  const hour = 3_600_000;
  const activityRequests = Math.ceil(hour / RECEIPT_ACTIVITY_PENDING_POLL_MS);
  const saleRequests =
    Math.max(0, Math.trunc(openSaleDetails)) *
    Math.ceil(hour / RECEIPT_SALE_PENDING_POLL_MS);
  return {
    requests: activityRequests + saleRequests,
    weightedUnits:
      activityRequests * RECEIPT_ACTIVITY_READ_COST +
      saleRequests * RECEIPT_SALE_READ_COST,
  };
}

export function maximumReceiptPollRequestsPerHour(saleDetailOpen: boolean) {
  return receiptPollingBudgetPerHour(saleDetailOpen ? 1 : 0).requests;
}
