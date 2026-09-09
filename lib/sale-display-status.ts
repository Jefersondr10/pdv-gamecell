import type { ReceiptAttachmentRecord, SaleRecord } from './pdv-types.ts';

// Priority is shared with server filters; optional manual follow-up never overrides it.
export const SYSTEM_SALE_STATUSES = [
  { key: 'cancelled', label: 'Cancelado', tone: 'muted' },
  { key: 'missing_price', label: 'Sem valor de venda', tone: 'warning' },
  { key: 'missing_receipt', label: 'Sem comprovante', tone: 'warning' },
  { key: 'review', label: 'Verificar comprovante', tone: 'warning' },
  { key: 'reading', label: 'Comprovante em leitura', tone: 'neutral' },
  { key: 'pending_payment', label: 'Pagamento pendente', tone: 'warning' },
  { key: 'overpaid', label: 'Pagamento acima da venda', tone: 'warning' },
  { key: 'missing_photo', label: 'Sem foto do aparelho', tone: 'warning' },
  { key: 'reconciled', label: 'Conciliado', tone: 'success' },
] as const;
export type SystemSaleStatusKey = (typeof SYSTEM_SALE_STATUSES)[number]['key'];

export const SYSTEM_SALE_STATUS_DESCRIPTIONS: Record<
  SystemSaleStatusKey,
  string
> = {
  cancelled:
    'A venda foi cancelada e não entra nos totais de vendas concluídas.',
  missing_price: 'Há produto sem preço de venda válido.',
  missing_receipt: 'Nenhum comprovante foi anexado à venda.',
  review: 'Há leitura inválida ou o total dos comprovantes difere da venda.',
  reading: 'Há comprovante aguardando a conclusão da leitura.',
  pending_payment: 'O pagamento informado está abaixo do valor da venda.',
  overpaid: 'O pagamento informado está acima do valor da venda.',
  missing_photo: 'Falta foto em pelo menos um aparelho vendido.',
  reconciled:
    'Preços preenchidos, fotos anexadas e venda, pagamento e comprovantes com valores iguais. Não confirma crédito bancário.',
};

export function isAutomaticStatusName(name: string) {
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  return SYSTEM_SALE_STATUSES.some(
    (status) => normalize(status.label) === normalize(name),
  );
}
type StatusSale = Pick<
  SaleRecord,
  'status' | 'reconciliation' | 'productsTotalCents' | 'receivedTotalCents'
> & {
  items: { soldPriceCents: number; photos: readonly unknown[] }[];
  receipts: Pick<
    ReceiptAttachmentRecord,
    'receiptAmountCents' | 'receiptOcrStatus'
  >[];
};
export function saleIssues(sale: StatusSale) {
  if (sale.status === 'cancelled') return [];
  const failed = sale.receipts.some((receipt) =>
    receipt.receiptAmountCents !== null
      ? receipt.receiptAmountCents <= 0
      : !['pending', 'processing', 'retry'].includes(
          receipt.receiptOcrStatus ?? '',
        ),
  );
  const conditions: Partial<Record<SystemSaleStatusKey, boolean>> = {
    missing_price:
      sale.productsTotalCents <= 0 ||
      sale.items.length === 0 ||
      sale.items.some((item) => item.soldPriceCents <= 0),
    missing_receipt: sale.receipts.length === 0,
    review: failed || sale.reconciliation.status === 'divergent',
    reading:
      !failed &&
      sale.receipts.some((receipt) => receipt.receiptAmountCents === null),
    pending_payment: sale.receivedTotalCents < sale.productsTotalCents,
    overpaid: sale.receivedTotalCents > sale.productsTotalCents,
    missing_photo: sale.items.some((item) => item.photos.length === 0),
  };
  return SYSTEM_SALE_STATUSES.filter((status) => conditions[status.key]);
}
export function saleDisplayStatus(sale: StatusSale) {
  if (sale.status === 'cancelled') return SYSTEM_SALE_STATUSES[0];
  return saleIssues(sale)[0] ?? SYSTEM_SALE_STATUSES[8];
}
