import type { ReceiptAttachmentRecord } from './pdv-types.ts';

export type OverviewTotals = {
  saleCount: number;
  receivedCents: number;
  cashCents: number;
  receiptCents: number;
  receiptCount: number;
  pendingCount: number;
  missingCount: number;
  divergentCount: number;
};

export type OverviewSale = {
  id: string;
  number: number;
  customerName: string;
  createdAt: number;
  receivedCents: number;
  cashCents: number;
  receiptCents: number;
  receiptCount: number;
  pendingCount: number;
  receipts: (ReceiptAttachmentRecord & { processingStatus: string | null })[];
};

export type OverviewPage = {
  totals: OverviewTotals;
  items: OverviewSale[];
  nextCursor: string | null;
};

// Compare documented amounts with payments entered, never with product prices.
// Equal aggregate sums can conceal opposite differences in individual sales.
export function overviewComparison(totals: OverviewTotals) {
  if (!totals.saleCount) return 'empty';
  if (totals.pendingCount || totals.missingCount) return 'pending';
  if (totals.receiptCents !== totals.receivedCents || totals.divergentCount)
    return 'review';
  return 'matched';
}
