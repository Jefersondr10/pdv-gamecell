import type { SaleRecord } from './pdv-types.ts';

export function saleDisplayStatus(
  sale: Pick<SaleRecord, 'status' | 'orderStatus' | 'reconciliation'>,
) {
  if (sale.status === 'cancelled')
    return { key: 'cancelled', label: 'Cancelado', tone: 'muted' } as const;
  if (sale.reconciliation.status === 'reconciled')
    return { key: 'reconciled', label: 'Conciliado', tone: 'success' } as const;
  if (sale.reconciliation.status === 'divergent')
    return {
      key: 'review',
      label: 'Verificar comprovantes',
      tone: 'warning',
    } as const;
  return {
    key: 'pending',
    label: 'Aguardando conciliação',
    tone: 'neutral',
  } as const;
}
