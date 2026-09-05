export type ReceiptAmountSource = 'ocr' | 'manual';

export type ReceiptValueInput = {
  amountCents: number | null;
  source: ReceiptAmountSource | null;
};

export type ReceiptReconciliation = {
  status: 'pending' | 'reconciled' | 'divergent';
  confirmedTotalCents: number;
  differenceCents: number | null;
  pendingReceiptCount: number;
};

export function deriveReceiptReconciliation(
  receipts: Array<{
    amountCents?: number | null;
    receiptAmountCents?: number | null;
  }>,
  productsTotalCents: number,
): ReceiptReconciliation {
  const values = receipts.map(
    (receipt) => receipt.receiptAmountCents ?? receipt.amountCents ?? null,
  );
  const pendingReceiptCount = values.filter((value) => value === null).length;
  const confirmedTotalCents = values.reduce<number>(
    (sum, value) => sum + (value ?? 0),
    0,
  );

  if (productsTotalCents <= 0) {
    return {
      status: 'pending',
      confirmedTotalCents,
      differenceCents: null,
      pendingReceiptCount,
    };
  }

  if (receipts.length === 0 || pendingReceiptCount > 0) {
    return {
      status: 'pending',
      confirmedTotalCents,
      differenceCents: null,
      pendingReceiptCount: receipts.length === 0 ? 1 : pendingReceiptCount,
    };
  }

  const differenceCents = confirmedTotalCents - productsTotalCents;
  return {
    status: differenceCents === 0 ? 'reconciled' : 'divergent',
    confirmedTotalCents,
    differenceCents,
    pendingReceiptCount: 0,
  };
}
