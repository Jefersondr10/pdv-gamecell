import type { ReceiptAttachmentRecord } from './pdv-types.ts';
import type {
  SystemSaleStatusKey,
  SaleDisplayStatus,
  SaleIssueKey,
} from './sale-display-status.ts';

export type OverviewTotals = {
  receiptReviewCount?: number;
  saleCount: number;
  receivedCents: number;
  cashCents: number;
  pixCents: number;
  receiptCents: number;
  receiptCount: number;
  pendingCount: number;
  missingCount: number;
  divergentCount: number;
  shortfallCents: number;
  surplusCents: number;
  saleDifferenceCount: number;
};

export type OverviewSale = {
  receiptReviewCount?: number;
  id: string;
  number: number;
  customerName: string;
  createdAt: number;
  receivedCents: number;
  saleCents: number;
  saleInvalid: number;
  automaticStatus: SystemSaleStatusKey | null;
  displayStatus: SaleDisplayStatus;
  issueKeys: SaleIssueKey[];
  cashCents: number;
  pixCents: number;
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
  { value: 'review', label: 'Pendências de conferência' },
  { value: 'matched', label: 'Valores conferem' },
  { value: 'divergent', label: 'Diferença / preço não definido' },
  { value: 'pending', label: 'Sem valor válido / em leitura' },
  { value: 'missing', label: 'Sem comprovante' },
] as const;
export type OverviewFilter = (typeof overviewFilters)[number]['value'];

// Keep all three totals distinct, and never imply agreement from just two of them.
export function overviewSaleComparison(
  sale: Pick<
    OverviewSale,
    | 'receiptCount'
    | 'pendingCount'
    | 'receiptCents'
    | 'receivedCents'
    | 'pixCents'
    | 'saleCents'
    | 'saleInvalid'
    | 'receiptReviewCount'
  >,
) {
  if (sale.receiptReviewCount) return 'review';
  if (!sale.receiptCount && sale.pixCents > 0) return 'missing';
  if (sale.pendingCount) return 'pending';
  if (sale.saleInvalid) return 'missing_price';
  if (sale.receiptCents < sale.pixCents) return 'below';
  if (sale.receiptCents > sale.pixCents) return 'above';
  if (sale.receivedCents !== sale.saleCents) return 'sale_difference';
  if (!sale.receiptCount && sale.pixCents === 0) return 'not_required';
  return 'matched';
}

// Equal aggregate sums can conceal opposite differences in individual sales.
export function overviewComparison(totals: OverviewTotals) {
  if (!totals.saleCount) return 'empty';
  if (totals.divergentCount || totals.receiptReviewCount) return 'review';
  if (totals.pendingCount || totals.missingCount) return 'pending';
  if (totals.receiptCents !== totals.pixCents || totals.divergentCount)
    return 'review';
  return 'matched';
}
