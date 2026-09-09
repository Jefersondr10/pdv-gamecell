import type { SaleRecord } from './pdv-types.ts';
import {
  deriveReceiptReconciliation,
  paymentMethodTotals,
} from './receipt-reconciliation.ts';
import { parseMoneyInput } from './money.ts';

export function parseSalePriceInput(value: string) {
  // Reject signs, words and accounting negatives instead of silently stripping them.
  const input = value.trim().replace(/^R\$\s*/, '');
  return /^[\d.,\s]+$/.test(input) ? parseMoneyInput(input) : 0;
}

export type SalePrices = {
  revision: number;
  status: 'completed' | 'cancelled';
  productsTotalCents: number;
  receivedTotalCents: number;
  receivedDifferenceCents: number;
  priceDifferenceCents: number;
  items: { id: string; soldPriceCents: number }[];
};

// Apply only the server-confirmed prices; never rewrite payments or receipts.
export function applySalePrices(
  sale: SaleRecord,
  value: SalePrices,
): SaleRecord {
  return {
    ...sale,
    status: value.status,
    items: sale.items.map((item) => ({
      ...item,
      soldPriceCents:
        value.items.find((updated) => updated.id === item.id)?.soldPriceCents ??
        item.soldPriceCents,
    })),
    productsTotalCents: value.productsTotalCents,
    receivedTotalCents: value.receivedTotalCents,
    receivedDifferenceCents: value.receivedDifferenceCents,
    priceDifferenceCents: value.priceDifferenceCents,
    reconciliation: deriveReceiptReconciliation(
      sale.receipts,
      paymentMethodTotals(sale.payments).pixCents,
    ),
  };
}

export function originalPriceSnapshot(value: string | null) {
  if (!value) return null;
  try {
    const snapshot = JSON.parse(value) as {
      totalCents: number;
      receivedTotalCents: number;
      items: { serial: string; soldPriceCents: number }[];
    };
    if (
      !Number.isSafeInteger(snapshot.totalCents) ||
      snapshot.totalCents <= 0 ||
      !Number.isSafeInteger(snapshot.receivedTotalCents) ||
      snapshot.receivedTotalCents < 0 ||
      !Array.isArray(snapshot.items) ||
      !snapshot.items.length ||
      snapshot.items.some(
        (item) =>
          typeof item.serial !== 'string' ||
          !Number.isSafeInteger(item.soldPriceCents) ||
          item.soldPriceCents < 0,
      )
    )
      return null;
    return snapshot;
  } catch {
    return null;
  }
}
