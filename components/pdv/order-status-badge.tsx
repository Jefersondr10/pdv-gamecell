import { Badge } from '@/components/ui/badge';
import type { OrderStatusColor } from '@/lib/pdv-types';

export const ORDER_STATUS_COLOR_OPTIONS: Array<{
  value: OrderStatusColor;
  label: string;
}> = [
  { value: 'slate', label: 'Cinza' },
  { value: 'blue', label: 'Azul' },
  { value: 'amber', label: 'Amarelo' },
  { value: 'orange', label: 'Laranja' },
  { value: 'green', label: 'Verde' },
  { value: 'red', label: 'Vermelho' },
  { value: 'purple', label: 'Roxo' },
  { value: 'pink', label: 'Rosa' },
];

const DOT_CLASSES: Record<OrderStatusColor, string> = {
  slate: 'bg-slate-500',
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  green: 'bg-emerald-500',
  red: 'bg-red-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
};

const BADGE_CLASSES: Record<OrderStatusColor, string> = {
  slate: 'border-slate-200 bg-slate-100 text-slate-800',
  blue: 'border-blue-200 bg-blue-50 text-blue-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  orange: 'border-orange-200 bg-orange-50 text-orange-900',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  red: 'border-red-200 bg-red-50 text-red-800',
  purple: 'border-purple-200 bg-purple-50 text-purple-800',
  pink: 'border-pink-200 bg-pink-50 text-pink-800',
};

export function OrderStatusDot({ color }: { color: OrderStatusColor }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2.5 shrink-0 rounded-full ${DOT_CLASSES[color]}`}
    />
  );
}

export function OrderStatusBadge({
  status,
}: {
  status: { name: string; color: OrderStatusColor };
}) {
  return (
    <Badge
      className={`max-w-full gap-1.5 overflow-hidden border shadow-none hover:bg-inherit ${BADGE_CLASSES[status.color]}`}
      variant="outline"
    >
      <OrderStatusDot color={status.color} />
      <span className="truncate">{status.name}</span>
    </Badge>
  );
}
