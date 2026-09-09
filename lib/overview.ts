import type { ReceiptAttachmentRecord } from './pdv-types.ts';
import type { SystemSaleStatusKey } from './sale-display-status.ts';

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
  saleDifferenceCount: number;
};

export type OverviewSale = {
  id: string;
  number: number;
  customerName: string;
  createdAt: number;
  receivedCents: number;
  saleCents: number;
  saleInvalid: number;
  automaticStatus: SystemSaleStatusKey;
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
  { value: 'review', label: 'Verificar comprovante' },
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
    | 'saleCents'
    | 'saleInvalid'
  >,
) {
  if (!sale.receiptCount) return 'missing';
  if (sale.pendingCount) return 'pending';
  if (sale.saleInvalid) return 'missing_price';
  if (sale.receiptCents < sale.receivedCents) return 'below';
  if (sale.receiptCents > sale.receivedCents) return 'above';
  if (sale.receiptCents !== sale.saleCents) return 'sale_difference';
  return 'matched';
}

// Equal aggregate sums can conceal opposite differences in individual sales.
export function overviewComparison(totals: OverviewTotals) {
  if (!totals.saleCount) return 'empty';
  if (totals.divergentCount) return 'review';
  if (totals.pendingCount || totals.missingCount) return 'pending';
  if (totals.receiptCents !== totals.receivedCents || totals.divergentCount)
    return 'review';
  return 'matched';
}
