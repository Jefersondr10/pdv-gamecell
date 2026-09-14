import {
  receiptEvidenceAliases,
  type ReceiptDocument,
} from './receipt-document.ts';
import { hasEffectiveReceiptReviewReason } from './receipt-review-reasons.ts';

type Receipt = {
  receiptAmountCents: number | null;
  receiptDetails?: ReceiptDocument | null;
  receiptReviewReason?: string | null;
  receiptPaymentId?: string | null;
};
type Sale = {
  productsTotalCents: number;
  payments: readonly { method: string; amountCents: number }[];
  receipts: readonly Receipt[];
};

// The receipt is the Pix value itself, not evidence for a separately typed Pix.
// Legacy payment rows remain in the audit trail but cannot override this total.
export function receiptIncomeCents(receipt: Receipt) {
  const amount = receipt.receiptAmountCents;
  const doc = receipt.receiptDetails;
  const acceptedEvidence = Boolean(
    Number.isSafeInteger(amount) &&
    amount! > 0 &&
    (!doc ||
      (!doc.blocked &&
        !doc.ambiguous &&
        !['scheduled', 'cancelled'].includes(doc.state) &&
        (doc.automaticEligible || Boolean(receipt.receiptPaymentId)))),
  );
  if (
    !acceptedEvidence ||
    hasEffectiveReceiptReviewReason(
      receipt.receiptReviewReason,
      acceptedEvidence,
    )
  )
    return 0;
  return amount!;
}

export function saleReceiptIncome(sale: Sale) {
  const cashCents = sale.payments.reduce(
    (sum, payment) =>
      sum + (payment.method === 'cash' ? payment.amountCents : 0),
    0,
  );
  const pixCents = sale.receipts.reduce((sum, receipt) => {
    const aliases = receiptEvidenceAliases(receipt.receiptDetails);
    const duplicate = aliases.some(
      (alias) =>
        sale.receipts.filter((candidate) =>
          receiptEvidenceAliases(candidate.receiptDetails).includes(alias),
        ).length > 1,
    );
    return sum + (duplicate ? 0 : receiptIncomeCents(receipt));
  }, 0);
  return {
    cashCents,
    pixCents,
    receivedTotalCents: cashCents + pixCents,
    receivedDifferenceCents: cashCents + pixCents - sale.productsTotalCents,
    receiptTargetCents: Math.max(0, sale.productsTotalCents - cashCents),
  };
}

export function receiptDrivenPayments(sale: {
  payments: readonly {
    id: string;
    method: 'pix' | 'cash';
    amountCents: number;
    pixAccountId: string | null;
    accountName: string | null;
  }[];
  receipts: readonly (Receipt & {
    id: string;
    receiptPaymentId?: string | null;
  })[];
}) {
  return [
    ...sale.receipts.flatMap((receipt) => {
      const amountCents = receiptIncomeCents(receipt);
      const transactionAliases = receiptEvidenceAliases(receipt.receiptDetails);
      if (
        !amountCents ||
        transactionAliases.some(
          (alias) =>
            sale.receipts.filter((candidate) =>
              receiptEvidenceAliases(candidate.receiptDetails).includes(alias),
            ).length > 1,
        )
      )
        return [];
      const registered = sale.payments.find(
        (p) => p.id === receipt.receiptPaymentId && p.method === 'pix',
      );
      return [
        {
          id: `receipt:${receipt.id}`,
          method: 'pix' as const,
          amountCents,
          pixAccountId: registered?.pixAccountId ?? null,
          recipientName: receipt.receiptDetails?.recipientName?.trim() || null,
          accountName:
            receipt.receiptDetails?.recipientBank ||
            registered?.accountName ||
            'Banco não identificado',
        },
      ];
    }),
    ...sale.payments
      .filter((payment) => payment.method === 'cash')
      .map((payment) => ({ ...payment, recipientName: null })),
  ];
}
