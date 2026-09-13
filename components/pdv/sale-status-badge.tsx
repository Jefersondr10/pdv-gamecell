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
import { OrderStatusBadge } from './order-status-badge';

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
  if (status.key === 'manual' && status.color)
    return (
      <OrderStatusBadge status={{ name: status.label, color: status.color }} />
    );
  if (status.key === 'none')
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-sm text-muted-foreground">
        Sem status
      </span>
    );
  return (
    <SystemSaleStatusBadge
      statusKey={status.key as SystemSaleStatusKey}
      pixCents={pixCents}
      cashCents={cashCents}
    />
  );
}

export function SaleIssuesNotice({
  issueKeys,
  compact = false,
}: {
  issueKeys: SaleIssueKey[];
  compact?: boolean;
}) {
  const issues = SALE_ISSUES.filter((issue) => issueKeys.includes(issue.key));
  if (!issues.length) return null;
  return (
    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
      Conferência:{' '}
      {compact
        ? `${issues[0].label}${issues.length > 1 ? ` · +${issues.length - 1} aviso(s)` : ''}`
        : issues.map((issue) => issue.label).join(' · ')}
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
          : 'bg-muted text-muted-foreground',
      )}
      title={
        status.key === 'reconciled'
          ? pixCents > 0 && cashCents > 0
            ? 'Pix e dinheiro conferem com a venda; comprovantes conferem com o Pix; fotos anexadas. Dinheiro informado manualmente. Não confirma crédito bancário.'
            : pixCents > 0
              ? 'Pix confere com a venda; comprovantes conferem com o Pix; fotos anexadas. Não confirma crédito bancário.'
              : cashCents > 0
                ? 'Dinheiro confere com a venda; fotos anexadas. Dinheiro informado manualmente.'
                : 'Venda conciliada; preços e fotos preenchidos.'
          : status.label
      }
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      <span className="truncate">{status.label}</span>
    </span>
  );
}
