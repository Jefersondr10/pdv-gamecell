import { saleDisplayStatus } from './sale-display-status.ts';
import { receiptIncomeCents, saleReceiptIncome } from './receipt-income.ts';
import { receiptTargetLabel } from './receipt-reconciliation.ts';

type SummarySale = Parameters<typeof saleDisplayStatus>[0];
const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// A matching manually entered payment alone is not a reconciled sale.
// Keep document evidence separate; displaying it must never change payments.
export function saleFinancialSummary(sale: SummarySale) {
  const { pixCents, cashCents, receivedTotalCents, receiptTargetCents } =
    saleReceiptIncome(sale);
  const reconciled = saleDisplayStatus(sale).key === 'reconciled';
  const cancelled = sale.status === 'cancelled';
  const receiptAmounts = sale.receipts.map(receiptIncomeCents);
  const completeReceipts =
    receiptAmounts.length > 0 && receiptAmounts.every((amount) => amount > 0);
  const receiptTotalCents = completeReceipts
    ? receiptAmounts.reduce((total, amount) => total + amount, 0)
    : null;
  const receiptDifferenceCents =
    receiptTotalCents !== null ? receiptTotalCents - receiptTargetCents : null;
  const receiptWarning =
    !cancelled &&
    receiptDifferenceCents !== null &&
    receiptDifferenceCents !== 0;
  const receiptText =
    cancelled || receiptTotalCents === null
      ? null
      : `Comprovantes ${money(receiptTotalCents)}${
          receiptWarning
            ? ` · ${money(Math.abs(receiptDifferenceCents!))} ${receiptDifferenceCents! < 0 ? 'abaixo' : 'acima'} do ${receiptTargetLabel(cashCents)}`
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
        : `Recebido ${money(receivedTotalCents)}`,
  };
}
