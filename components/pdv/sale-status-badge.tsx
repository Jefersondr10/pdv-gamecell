import type { SaleRecord } from '@/lib/pdv-types';
import {
  saleDisplayStatus,
  SYSTEM_SALE_STATUSES,
  type SystemSaleStatusKey,
  type SaleDisplayStatus,
  type SaleIssueKey,
  SALE_ISSUES,
} from '@/lib/sale-display-status';
import { cn } from '@/lib/utils';
import { saleReceiptIncome } from '@/lib/receipt-income';

export function SaleStatusBadge({ sale }: { sale: SaleRecord }) {
  const status = saleDisplayStatus(sale);
  const { pixCents, cashCents } = saleReceiptIncome(sale);
  return (
    <SaleDisplayStatusBadge
      status={status}
      pixCents={pixCents}
      cashCents={cashCents}
    />
  );
}

export function SaleDisplayStatusBadge({
  status,
  pixCents = 0,
  cashCents = 0,
}: {
  status: SaleDisplayStatus;
  pixCents?: number;
  cashCents?: number;
}) {
  return (
    <SystemSaleStatusBadge
      statusKey={status.key}
      pixCents={pixCents}
      cashCents={cashCents}
    />
  );
}

export function SaleIssuesNotice({
  issueKeys,
  compact = false,
  emphasized = false,
}: {
  issueKeys: SaleIssueKey[];
  compact?: boolean;
  emphasized?: boolean;
}) {
  // The first status is already shown by the adjacent badge. List only the
  // additional statuses, instead of a second, competing warning system.
  const issues = SALE_ISSUES.filter((issue) =>
    issueKeys.includes(issue.key),
  ).slice(1);
  if (!issues.length) return null;
  if (emphasized)
    return (
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        {compact ? (
          <p className="font-bold">
            Também: {issues.map((issue) => issue.label).join(' · ')}
          </p>
        ) : (
          <>
            <p className="font-extrabold">Outros status da venda</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 font-semibold">
              {issues.map((issue) => (
                <li key={issue.key}>{issue.label}</li>
              ))}
            </ol>
          </>
        )}
      </div>
    );
  return (
    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
      Também: {issues.map((issue) => issue.label).join(' · ')}
    </p>
  );
}

export function SystemSaleStatusBadge({
  statusKey,
  pixCents = 0,
  cashCents = 0,
}: {
  statusKey: SystemSaleStatusKey;
  pixCents?: number;
  cashCents?: number;
}) {
  const status = SYSTEM_SALE_STATUSES.find((item) => item.key === statusKey);
  if (!status) return null;
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-sm font-semibold leading-5',
        status.tone === 'success'
          ? 'bg-success/10 text-success'
          : status.tone === 'warning'
            ? 'bg-amber-100 text-amber-950 dark:bg-amber-950/50 dark:text-amber-200'
            : status.tone === 'neutral'
              ? 'bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200'
              : 'bg-muted text-muted-foreground',
      )}
      title={
        status.key === 'reconciled'
          ? pixCents > 0 && cashCents > 0
            ? 'Pix e dinheiro conferem com a venda; fotos anexadas. Não confirma crédito bancário.'
            : pixCents > 0
              ? 'Pix confere com a venda; comprovantes conferem com o Pix; fotos anexadas. Não confirma crédito bancário.'
              : cashCents > 0
                ? 'Dinheiro confere com a venda; fotos anexadas.'
                : 'Venda conciliada; preços e fotos preenchidos.'
          : status.label
      }
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      <span>{status.label}</span>
    </span>
  );
}
