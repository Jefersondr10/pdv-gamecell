import type { SaleRecord } from '@/lib/pdv-types';
import { saleDisplayStatus } from '@/lib/sale-display-status';
import { cn } from '@/lib/utils';

export function SaleStatusBadge({ sale }: { sale: SaleRecord }) {
  const status = saleDisplayStatus(sale);
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-sm font-semibold leading-5',
        status.tone === 'success'
          ? 'bg-success/10 text-success'
          : status.tone === 'warning'
            ? 'bg-amber-500/10 text-amber-800 dark:text-amber-200'
            : 'bg-muted text-muted-foreground',
      )}
      title={
        status.key === 'reconciled'
          ? 'Valores dos comprovantes conferidos com a venda. Não confirma crédito bancário.'
          : status.label
      }
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      <span className="truncate">{status.label}</span>
    </span>
  );
}
