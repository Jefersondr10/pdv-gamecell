import { saleDisplayStatus } from './sale-display-status.ts';
import { paymentMethodTotals } from './receipt-reconciliation.ts';

type SummarySale = Parameters<typeof saleDisplayStatus>[0];
const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// A matching manually entered payment alone is not a reconciled sale.
// Keep document evidence separate; displaying it must never change payments.
export function saleFinancialSummary(sale: SummarySale) {
  const { pixCents, cashCents } = paymentMethodTotals(sale.payments);
  const reconciled = saleDisplayStatus(sale).key === 'reconciled';
  const cancelled = sale.status === 'cancelled';
  const completeReceipts =
    sale.receipts.length > 0 &&
    sale.receipts.every(
      (receipt) =>
        Number.isSafeInteger(receipt.receiptAmountCents) &&
        receipt.receiptAmountCents! > 0,
    );
  const receiptTotalCents = completeReceipts
    ? sale.receipts.reduce(
        (total, receipt) => total + receipt.receiptAmountCents!,
        0,
      )
    : null;
  const receiptDifferenceCents =
    receiptTotalCents !== null ? receiptTotalCents - pixCents : null;
  const receiptWarning =
    !cancelled &&
    receiptDifferenceCents !== null &&
    receiptDifferenceCents !== 0;
  const receiptText =
    cancelled || receiptTotalCents === null
      ? null
      : `Comprovantes ${money(receiptTotalCents)}${
          receiptWarning
            ? ` · ${money(Math.abs(receiptDifferenceCents!))} ${receiptDifferenceCents! < 0 ? 'abaixo' : 'acima'} do Pix informado`
            : ''
        }`;
  return {
    reconciled,
    pixCents,
    cashCents,
    receiptTotalCents,
    receiptDifferenceCents,
    receiptWarning,
    receiptText,
    paymentLabel: cancelled
      ? 'Venda cancelada'
      : reconciled
        ? 'Venda / pago'
        : `Pago informado ${money(sale.receivedTotalCents)}`,
  };
}
