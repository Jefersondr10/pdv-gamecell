import type {
  ReceiptAttachmentRecord,
  SaleRecord,
  OrderStatusColor,
} from './pdv-types.ts';
import { normalizeOrderStatusName } from './order-status-names.ts';
import { saleReceiptIncome } from './receipt-income.ts';
import { deriveReceiptReconciliation } from './receipt-reconciliation.ts';
import { receiptEvidenceAliases } from './receipt-document.ts';

const TERMINAL_SALE_STATUSES = [
  { key: 'cancelled', label: 'Cancelado', tone: 'muted' },
  { key: 'reconciled', label: 'Conciliado', tone: 'success' },
] as const;

// Status and pending checks are the same ordered facts. A saved store label must
// never hide a missing payment/document, nor prevent automatic reconciliation.
export const SALE_ISSUES = [
  { key: 'missing_price', label: 'Falta preço de venda', tone: 'warning' },
  { key: 'missing_receipt', label: 'Falta comprovante', tone: 'warning' },
  { key: 'review', label: 'Revisar comprovante', tone: 'warning' },
  { key: 'reading', label: 'Comprovante em leitura', tone: 'neutral' },
  { key: 'pending_payment', label: 'Pagamento incompleto', tone: 'warning' },
  { key: 'overpaid', label: 'Pagamento acima da venda', tone: 'warning' },
  { key: 'missing_photo', label: 'Falta foto do aparelho', tone: 'warning' },
] as const;
export type SaleIssueKey = (typeof SALE_ISSUES)[number]['key'];
export const SALE_CHECK_STATUSES = [
  TERMINAL_SALE_STATUSES[0],
  ...SALE_ISSUES,
  TERMINAL_SALE_STATUSES[1],
] as const;
export type SaleCheckKey = (typeof SALE_CHECK_STATUSES)[number]['key'];
export const SYSTEM_SALE_STATUSES = SALE_CHECK_STATUSES;
export type SystemSaleStatusKey = SaleCheckKey;

export const SYSTEM_SALE_STATUS_DESCRIPTIONS: Record<SaleCheckKey, string> = {
  cancelled:
    'A venda foi cancelada e não entra nos totais de vendas concluídas.',
  missing_price: 'Há produto sem preço de venda válido.',
  missing_receipt: 'Há saldo a receber sem comprovante anexado.',
  review:
    'Há comprovante ilegível, duplicado, não confirmado ou com leitura que precisa de revisão.',
  reading: 'Há comprovante aguardando a conclusão da leitura.',
  pending_payment: 'Comprovantes mais dinheiro estão abaixo do valor da venda.',
  overpaid: 'Comprovantes mais dinheiro estão acima do valor da venda.',
  missing_photo: 'Falta foto em pelo menos um aparelho vendido.',
  reconciled:
    'Preços e fotos preenchidos, comprovantes aceitos mais dinheiro iguais ao valor da venda. Não confirma crédito bancário.',
};

export function isAutomaticStatusName(name: string) {
  return [
    ...SYSTEM_SALE_STATUSES,
    ...[
      'Sem valor de venda',
      'Sem comprovante',
      'Verificar comprovante',
      'Pagamento pendente',
      'Sem foto do aparelho',
      'Sem status',
    ].map((label) => ({ label })),
  ].some(
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
    | 'receiptAmountCents'
    | 'receiptOcrStatus'
    | 'receiptReviewReason'
    | 'receiptDetails'
    | 'receiptPaymentId'
  >[];
};
export function saleIssues(sale: StatusSale) {
  if (sale.status === 'cancelled') return [];
  const income = saleReceiptIncome(sale);
  const reconciliation = deriveReceiptReconciliation(
    sale.receipts,
    income.receiptTargetCents,
  );
  const failed = sale.receipts.some((receipt) =>
    receipt.receiptDetails &&
    (receipt.receiptDetails.blocked ||
      receipt.receiptDetails.ambiguous ||
      ['scheduled', 'cancelled'].includes(receipt.receiptDetails.state) ||
      (!receipt.receiptDetails.automaticEligible && !receipt.receiptPaymentId))
      ? true
      : receipt.receiptAmountCents !== null
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
    missing_receipt:
      income.receiptTargetCents > 0 && sale.receipts.length === 0,
    review:
      failed ||
      Boolean(reconciliation.reviewReceiptCount) ||
      sale.receipts.some((receipt, index) =>
        receiptEvidenceAliases(receipt.receiptDetails).some((alias) =>
          sale.receipts.some(
            (other, otherIndex) =>
              index !== otherIndex &&
              receiptEvidenceAliases(other.receiptDetails).includes(alias),
          ),
        ),
      ),
    reading: sale.receipts.some((receipt) =>
      ['pending', 'processing', 'retry'].includes(
        receipt.receiptOcrStatus ?? '',
      ),
    ),
    pending_payment: income.receivedTotalCents < sale.productsTotalCents,
    overpaid: income.receivedTotalCents > sale.productsTotalCents,
    missing_photo: sale.items.some((item) => item.photos.length === 0),
  };
  return SALE_ISSUES.filter((status) => conditions[status.key]);
}
// One primary status, with all simultaneous statuses exposed by saleIssues.
export function saleCheckStatus(sale: StatusSale) {
  if (sale.status === 'cancelled') return TERMINAL_SALE_STATUSES[0];
  return saleIssues(sale)[0] ?? TERMINAL_SALE_STATUSES[1];
}
export function automaticSaleStatus(sale: StatusSale) {
  return saleCheckStatus(sale);
}
export type SaleDisplayStatus = {
  key: SystemSaleStatusKey;
  label: string;
  tone: 'muted' | 'success' | 'neutral' | 'warning';
  color?: OrderStatusColor;
};
export function resolveSaleDisplayStatus(
  automatic: SystemSaleStatusKey | null,
  _manual?: StatusSale['orderStatus'],
): SaleDisplayStatus {
  const system = SYSTEM_SALE_STATUSES.find(
    (status) => status.key === automatic,
  );
  if (system) return system;
  // Old API payloads with no computed status must not appear reconciled.
  return SALE_ISSUES.find((status) => status.key === 'review')!;
}
export function saleDisplayStatus(sale: StatusSale) {
  return resolveSaleDisplayStatus(
    automaticSaleStatus(sale)?.key ?? null,
    sale.orderStatus,
  );
}
