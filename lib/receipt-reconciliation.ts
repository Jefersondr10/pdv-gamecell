export type ReceiptAmountSource = 'ocr' | 'manual';

export type ReceiptValueInput = {
  amountCents: number | null;
  source: ReceiptAmountSource | null;
};

export type ReceiptReconciliation = {
  status: 'pending' | 'reconciled' | 'divergent' | 'not_required';
  confirmedTotalCents: number;
  differenceCents: number | null;
  pendingReceiptCount: number;
};

export function paymentMethodTotals(
  payments: readonly { method: string; amountCents: number }[],
) {
  return payments.reduce(
    (totals, payment) => {
      if (payment.method === 'pix') totals.pixCents += payment.amountCents;
      if (payment.method === 'cash') totals.cashCents += payment.amountCents;
      return totals;
    },
    { pixCents: 0, cashCents: 0 },
  );
}

export function deriveReceiptReconciliation(
  receipts: Array<{
    amountCents?: number | null;
    receiptAmountCents?: number | null;
  }>,
  pixTotalCents: number,
): ReceiptReconciliation {
  const values = receipts.map(
    (receipt) => receipt.receiptAmountCents ?? receipt.amountCents ?? null,
  );
  const validAmount = (value: number | null): value is number =>
    value !== null && Number.isSafeInteger(value) && value > 0;
  const pendingReceiptCount = values.filter(
    (value) => !validAmount(value),
  ).length;
  const confirmedTotalCents = values.reduce<number>(
    (sum, value) => sum + (validAmount(value) ? value : 0),
    0,
  );

  if (!Number.isSafeInteger(pixTotalCents) || pixTotalCents < 0) {
    return {
      status: 'pending',
      confirmedTotalCents,
      differenceCents: null,
      pendingReceiptCount,
    };
  }

  if (pixTotalCents === 0 && receipts.length === 0)
    return {
      status: 'not_required',
      confirmedTotalCents: 0,
      differenceCents: 0,
      pendingReceiptCount: 0,
    };

  if (receipts.length === 0 || pendingReceiptCount > 0) {
    return {
      status: 'pending',
      confirmedTotalCents,
      differenceCents: null,
      pendingReceiptCount: receipts.length === 0 ? 1 : pendingReceiptCount,
    };
  }

  const differenceCents = confirmedTotalCents - pixTotalCents;
  return {
    status: differenceCents === 0 ? 'reconciled' : 'divergent',
    confirmedTotalCents,
    differenceCents,
    pendingReceiptCount: 0,
  };
}
