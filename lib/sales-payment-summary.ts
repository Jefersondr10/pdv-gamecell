import { receiptDrivenPayments, saleReceiptIncome } from './receipt-income.ts';
import type { SaleRecord } from './pdv-types';

type SummarySale = Pick<
  SaleRecord,
  | 'status'
  | 'createdAt'
  | 'productsTotalCents'
  | 'receivedTotalCents'
  | 'payments'
  | 'receipts'
>;
type Destination = {
  key: string;
  label: string;
  amountCents: number;
  aliases: string[];
};
const normalizeName = (name: string | null) =>
  name?.trim().replace(/\s+/g, ' ') || '';

/** Read-only breakdown of the same filtered sales. Pix values come only from receipts; cash is entered manually. */
export function summarizeSalesPayments(sales: readonly SummarySale[]) {
  const destinations = new Map<
    string,
    Destination & { method: string; names: Map<string, number> }
  >();
  let soldCents = 0,
    receivedCents = 0,
    detailedCents = 0,
    outstandingCents = 0,
    excessCents = 0,
    inconsistentSaleCount = 0;
  for (const sale of sales) {
    if (sale.status !== 'completed') continue;
    const income = saleReceiptIncome(sale);
    soldCents += sale.productsTotalCents;
    receivedCents += income.receivedTotalCents;
    outstandingCents += Math.max(
      0,
      sale.productsTotalCents - income.receivedTotalCents,
    );
    excessCents += Math.max(
      0,
      income.receivedTotalCents - sale.productsTotalCents,
    );
    let saleDetailedCents = 0;
    for (const payment of receiptDrivenPayments(sale)) {
      saleDetailedCents += payment.amountCents;
      const name = normalizeName(payment.accountName);
      // IDs separate homonymous accounts. Legacy records without an ID retain their saved name.
      const key =
        payment.method === 'cash'
          ? 'cash'
          : JSON.stringify([
              'pix',
              payment.pixAccountId ? 'id' : 'legacy',
              payment.pixAccountId || name.toLocaleLowerCase('pt-BR'),
            ]);
      const item = destinations.get(key) ?? {
        key,
        label: '',
        amountCents: 0,
        aliases: [],
        method: payment.method,
        names: new Map<string, number>(),
      };
      item.amountCents += payment.amountCents;
      if (name)
        item.names.set(
          name,
          Math.max(sale.createdAt, item.names.get(name) ?? -Infinity),
        );
      destinations.set(key, item);
    }
    detailedCents += saleDetailedCents;
    // Compare each sale: differences from separate sales must not cancel each other out.
    if (
      saleDetailedCents !== income.receivedTotalCents ||
      sale.receivedTotalCents !== income.receivedTotalCents
    )
      inconsistentSaleCount++;
  }
  const compare = new Intl.Collator('pt-BR', {
    numeric: true,
    sensitivity: 'base',
  });
  const groups = [...destinations.values()]
    .map((item) => {
      const names = [...item.names]
        .sort((a, b) => b[1] - a[1] || compare.compare(a[0], b[0]))
        .map(([name]) => name);
      return {
        key: item.key,
        label:
          item.method === 'cash'
            ? 'Dinheiro'
            : `Pix · ${names[0] || 'Conta não informada'}`,
        amountCents: item.amountCents,
        aliases: item.method === 'cash' ? [] : names.slice(1),
      };
    })
    .sort(
      (a, b) =>
        Number(a.key === 'cash') - Number(b.key === 'cash') ||
        compare.compare(a.label, b.label) ||
        a.key.localeCompare(b.key),
    );
  return {
    groups,
    soldCents,
    receivedCents,
    detailedCents,
    outstandingCents,
    excessCents,
    inconsistentSaleCount,
  };
}

export type SalesPaymentSummary = ReturnType<typeof summarizeSalesPayments>;
