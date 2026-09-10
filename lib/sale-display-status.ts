import type {
  ReceiptAttachmentRecord,
  SaleRecord,
  OrderStatusColor,
} from './pdv-types.ts';
import { normalizeOrderStatusName } from './order-status-names.ts';
import {
  deriveReceiptReconciliation,
  paymentMethodTotals,
} from './receipt-reconciliation.ts';

// Only these outcomes are automatic. All other order statuses belong to the store.
export const SYSTEM_SALE_STATUSES = [
  { key: 'cancelled', label: 'Cancelado', tone: 'muted' },
  { key: 'reconciled', label: 'Conciliado', tone: 'success' },
] as const;
export type SystemSaleStatusKey = (typeof SYSTEM_SALE_STATUSES)[number]['key'];

// Mandatory checks remain independent of the status selected by the operator.
export const SALE_ISSUES = [
  { key: 'missing_price', label: 'Sem valor de venda', tone: 'warning' },
  { key: 'missing_receipt', label: 'Sem comprovante', tone: 'warning' },
  { key: 'review', label: 'Verificar comprovante', tone: 'warning' },
  { key: 'reading', label: 'Comprovante em leitura', tone: 'neutral' },
  { key: 'pending_payment', label: 'Pagamento pendente', tone: 'warning' },
  { key: 'overpaid', label: 'Pagamento acima da venda', tone: 'warning' },
  { key: 'missing_photo', label: 'Sem foto do aparelho', tone: 'warning' },
] as const;
export type SaleIssueKey = (typeof SALE_ISSUES)[number]['key'];
export const SALE_CHECK_STATUSES = [
  SYSTEM_SALE_STATUSES[0],
  ...SALE_ISSUES,
  SYSTEM_SALE_STATUSES[1],
] as const;
export type SaleCheckKey = (typeof SALE_CHECK_STATUSES)[number]['key'];

export const SYSTEM_SALE_STATUS_DESCRIPTIONS: Record<SaleCheckKey, string> = {
  cancelled:
    'A venda foi cancelada e não entra nos totais de vendas concluídas.',
  missing_price: 'Há produto sem preço de venda válido.',
  missing_receipt: 'Há pagamento em Pix sem comprovante anexado.',
  review:
    'Há leitura inválida ou o total dos comprovantes difere do Pix informado.',
  reading: 'Há comprovante aguardando a conclusão da leitura.',
  pending_payment: 'O pagamento informado está abaixo do valor da venda.',
  overpaid: 'O pagamento informado está acima do valor da venda.',
  missing_photo: 'Falta foto em pelo menos um aparelho vendido.',
  reconciled:
    'Preços e fotos preenchidos, Pix mais dinheiro igual à venda e comprovantes iguais ao Pix. Dinheiro informado manualmente; não confirma crédito bancário.',
};

export function isAutomaticStatusName(name: string) {
  return SYSTEM_SALE_STATUSES.some(
    (status) =>
      normalizeOrderStatusName(status.label) === normalizeOrderStatusName(name),
  );
}
type StatusSale = Pick<
  SaleRecord,
  'status' | 'reconciliation' | 'productsTotalCents' | 'receivedTotalCents'
> & {
  payments: readonly { method: string; amountCents: number }[];
  orderStatus?: { id: string; name: string; color: OrderStatusColor } | null;
  items: { soldPriceCents: number; photos: readonly unknown[] }[];
  receipts: Pick<
    ReceiptAttachmentRecord,
    'receiptAmountCents' | 'receiptOcrStatus' | 'receiptReviewReason'
  >[];
};
export function saleIssues(sale: StatusSale) {
  if (sale.status === 'cancelled') return [];
  const { pixCents } = paymentMethodTotals(sale.payments);
  const reconciliation = deriveReceiptReconciliation(sale.receipts, pixCents);
  const failed = sale.receipts.some((receipt) =>
    receipt.receiptAmountCents !== null
      ? !Number.isSafeInteger(receipt.receiptAmountCents) ||
        receipt.receiptAmountCents <= 0
      : !['pending', 'processing', 'retry'].includes(
          receipt.receiptOcrStatus ?? '',
        ),
  );
  const conditions: Partial<Record<SaleIssueKey, boolean>> = {
    missing_price:
      sale.productsTotalCents <= 0 ||
      sale.items.length === 0 ||
      sale.items.some((item) => item.soldPriceCents <= 0),
    missing_receipt: pixCents > 0 && sale.receipts.length === 0,
    review:
      failed ||
      reconciliation.status === 'divergent' ||
      sale.receipts.some((receipt) => Boolean(receipt.receiptReviewReason)),
    reading:
      !failed &&
      sale.receipts.some((receipt) => receipt.receiptAmountCents === null),
    pending_payment: sale.receivedTotalCents < sale.productsTotalCents,
    overpaid: sale.receivedTotalCents > sale.productsTotalCents,
    missing_photo: sale.items.some((item) => item.photos.length === 0),
  };
  return SALE_ISSUES.filter((status) => conditions[status.key]);
}
// Kept for old report links which filtered by the first warning.
export function saleCheckStatus(sale: StatusSale) {
  if (sale.status === 'cancelled') return SYSTEM_SALE_STATUSES[0];
  return saleIssues(sale)[0] ?? SYSTEM_SALE_STATUSES[1];
}
export function automaticSaleStatus(sale: StatusSale) {
  if (sale.status === 'cancelled') return SYSTEM_SALE_STATUSES[0];
  return saleIssues(sale).length === 0 ? SYSTEM_SALE_STATUSES[1] : null;
}
export type SaleDisplayStatus = {
  key: SystemSaleStatusKey | 'manual' | 'none';
  label: string;
  tone: 'muted' | 'success' | 'neutral';
  color?: OrderStatusColor;
};
export function resolveSaleDisplayStatus(
  automatic: SystemSaleStatusKey | null,
  manual: StatusSale['orderStatus'],
): SaleDisplayStatus {
  const system = SYSTEM_SALE_STATUSES.find(
    (status) => status.key === automatic,
  );
  if (system) return system;
  if (manual && !isAutomaticStatusName(manual.name))
    return {
      key: 'manual',
      label: manual.name,
      tone: 'neutral',
      color: manual.color,
    };
  return { key: 'none', label: 'Sem status', tone: 'muted' };
}
export function saleDisplayStatus(sale: StatusSale) {
  return resolveSaleDisplayStatus(
    automaticSaleStatus(sale)?.key ?? null,
    sale.orderStatus,
  );
}
