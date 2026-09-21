import type { SaleRecord } from './pdv-types';
import { receiptDrivenPayments } from './receipt-income.ts';
import {
  normalizeReceiptIdentity,
  shortReceiptDate,
} from './receipt-document.ts';

export type ReportDateBasis = 'sale' | 'receipt';
export type FinancialRow = {
  id: string;
  saleId: string;
  saleNumber: number;
  method: 'pix' | 'cash';
  amountCents: number;
  recipient: string;
  bank: string;
  payer: string;
  payerBank: string;
  account: string | null;
  date: string | null;
  time: string | null;
  dateKey: string | null;
  receiptId: string | null;
  recordedAt: number | null;
  transactionId: string | null;
  groupKey: string;
};
const normalize = (value: string) => normalizeReceiptIdentity(value);
export const reportMoney = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const reportDate = (ms: number) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(ms);
export const reportDayKey = (ms: number) =>
  new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);

// Never substitute sale/upload/reading time for the time printed on a Pix receipt.
export function identifiedReceiptDate(value: string | null | undefined) {
  const short = value ? shortReceiptDate(value) : '';
  const match = short.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?: · (\d{2}):(\d{2}))?$/,
  );
  if (!match) return { date: null, time: null, dateKey: null };
  const key = `${match[3]}-${match[2]}-${match[1]}`;
  const ms = Date.parse(`${key}T12:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== key)
    return { date: null, time: null, dateKey: null };
  const time =
    match[4] && Number(match[4]) < 24 && Number(match[5]) < 60
      ? `${match[4]}:${match[5]}`
      : null;
  return { date: `${match[1]}/${match[2]}/${match[3]}`, time, dateKey: key };
}

export function financialRows(sales: readonly SaleRecord[]): FinancialRow[] {
  return sales
    .filter((s) => s.status === 'completed')
    .flatMap((sale) =>
      receiptDrivenPayments(sale).map((payment) => {
        const receipt = sale.receipts.find(
          (r) => `receipt:${r.id}` === payment.id,
        );
        const doc = receipt?.receiptDetails;
        const cash = payment.method === 'cash';
        const record = sale.payments.find((p) => p.id === payment.id);
        const recordedAt = cash && record?.createdAt ? record.createdAt : null;
        const stamp =
          cash && recordedAt
            ? identifiedReceiptDate(reportDate(recordedAt).replace(', ', ' · '))
            : identifiedReceiptDate(doc?.paidAtText);
        const recipient = cash
          ? 'Dinheiro em caixa'
          : doc?.recipientName || 'Recebedor não identificado';
        const bank = cash
          ? 'Não se aplica'
          : doc?.recipientBank || 'Banco não identificado';
        const account = cash ? null : doc?.recipientAccount || null;
        // A bank name alone does not identify an account or its owner. Unknown
        // destinations stay separate instead of silently merging unrelated money.
        const identity = `${normalize(recipient)}:${doc?.recipientDocument || ''}`;
        const groupKey = cash
          ? 'cash'
          : JSON.stringify([
              identity,
              normalize(bank),
              account || '',
              !doc?.recipientName && !doc?.recipientDocument ? payment.id : '',
            ]);
        return {
          id: payment.id,
          saleId: sale.id,
          saleNumber: sale.number,
          method: payment.method,
          amountCents: payment.amountCents,
          recipient,
          bank,
          account,
          payer: doc?.payerName || 'Pagador não identificado',
          payerBank: doc?.payerBank || 'Banco pagador não identificado',
          ...stamp,
          recordedAt,
          receiptId: receipt?.id ?? null,
          transactionId:
            doc?.transactionId || doc?.alternateTransactionId || null,
          groupKey,
        };
      }),
    )
    .sort(
      (a, b) =>
        (a.dateKey ?? '9999').localeCompare(b.dateKey ?? '9999') ||
        (a.time ?? '99').localeCompare(b.time ?? '99') ||
        a.saleNumber - b.saleNumber ||
        a.id.localeCompare(b.id),
    );
}

export function reportDateWindow(filters: string, now: number) {
  const params = new URLSearchParams(filters);
  const period = params.get('period') || 'all';
  const today = reportDayKey(now);
  if (period === 'all') return { from: null, to: null };
  if (period === 'day')
    return { from: params.get('day'), to: params.get('day') };
  if (period === 'month') {
    const month = params.get('month') || today.slice(0, 7);
    const [year, m] = month.split('-').map(Number);
    return {
      from: `${month}-01`,
      to: new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10),
    };
  }
  const days = period === '7d' ? 7 : period === '15d' ? 15 : 1;
  const end =
    Date.parse(`${today}T12:00:00Z`) - (period === 'yesterday' ? 86400_000 : 0);
  return {
    from: new Date(end - (days - 1) * 86400_000).toISOString().slice(0, 10),
    to: new Date(end).toISOString().slice(0, 10),
  };
}

/** One sale heading, preserving every individual receipt and its chronological order. */
export function groupFinancialRowsBySale(rows: readonly FinancialRow[]) {
  const groups = new Map<
    string,
    {
      saleId: string;
      saleNumber: number;
      amountCents: number;
      rows: FinancialRow[];
    }
  >();
  for (const row of rows) {
    const group = groups.get(row.saleId) ?? {
      saleId: row.saleId,
      saleNumber: row.saleNumber,
      amountCents: 0,
      rows: [],
    };
    group.rows.push(row);
    group.amountCents += row.amountCents;
    groups.set(row.saleId, group);
  }
  return [...groups.values()];
}

export function summarizeFinancialReport(
  sales: readonly SaleRecord[],
  basis: ReportDateBasis = 'sale',
  filters = 'period=all',
  now = Date.now(),
) {
  const allRows = financialRows(sales);
  const window = reportDateWindow(filters, now);
  const filtered = basis === 'receipt' && Boolean(window.from && window.to);
  const undated = filtered ? allRows.filter((row) => !row.dateKey) : [];
  const rows = filtered
    ? allRows.filter(
        (row) =>
          row.dateKey &&
          row.dateKey >= window.from! &&
          row.dateKey <= window.to!,
      )
    : allRows;
  const groups = new Map<
    string,
    {
      key: string;
      recipient: string;
      bank: string;
      account: string | null;
      amountCents: number;
      count: number;
      method: 'pix' | 'cash';
    }
  >();
  for (const row of rows) {
    const group = groups.get(row.groupKey) ?? {
      key: row.groupKey,
      recipient: row.recipient,
      bank: row.bank,
      account: row.account,
      amountCents: 0,
      count: 0,
      method: row.method,
    };
    group.amountCents += row.amountCents;
    group.count++;
    groups.set(row.groupKey, group);
  }
  const pixCents = rows
    .filter((r) => r.method === 'pix')
    .reduce((sum, r) => sum + r.amountCents, 0);
  const cashCents = rows
    .filter((r) => r.method === 'cash')
    .reduce((sum, r) => sum + r.amountCents, 0);
  return {
    rows,
    saleGroups: groupFinancialRowsBySale(rows),
    groups: [...groups.values()].sort(
      (a, b) =>
        a.recipient.localeCompare(b.recipient, 'pt-BR') ||
        a.bank.localeCompare(b.bank, 'pt-BR'),
    ),
    pixCents,
    cashCents,
    totalCents: pixCents + cashCents,
    undatedCount: undated.length,
    undatedCents: undated.reduce((sum, r) => sum + r.amountCents, 0),
  };
}
