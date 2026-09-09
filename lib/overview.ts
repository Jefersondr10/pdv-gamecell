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
  shortfallCents: number;
  surplusCents: number;
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
  pendingInPeriod: number;
  items: OverviewSale[];
  nextCursor: string | null;
};

export const overviewFilters = [
  { value: 'all', label: 'Todos' },
  { value: 'matched', label: 'Valores conferem' },
  { value: 'divergent', label: 'Com diferença' },
  { value: 'pending', label: 'Conferência pendente' },
  { value: 'missing', label: 'Sem comprovante' },
] as const;
export type OverviewFilter = (typeof overviewFilters)[number]['value'];

// This screen checks evidence for payments entered, not whether the sale is paid.
// Keep that distinction explicit: the sales screen separately compares to sale price.
export function overviewSaleComparison(
  sale: Pick<
    OverviewSale,
    'receiptCount' | 'pendingCount' | 'receiptCents' | 'receivedCents'
  >,
) {
  if (!sale.receiptCount) return 'missing';
  if (sale.pendingCount) return 'pending';
  if (sale.receiptCents < sale.receivedCents) return 'below';
  if (sale.receiptCents > sale.receivedCents) return 'above';
  return 'matched';
}

// Compare documented amounts with payments entered, never with product prices.
// Equal aggregate sums can conceal opposite differences in individual sales.
export function overviewComparison(totals: OverviewTotals) {
  if (!totals.saleCount) return 'empty';
  if (totals.divergentCount) return 'review';
  if (totals.pendingCount || totals.missingCount) return 'pending';
  if (totals.receiptCents !== totals.receivedCents || totals.divergentCount)
    return 'review';
  return 'matched';
}
