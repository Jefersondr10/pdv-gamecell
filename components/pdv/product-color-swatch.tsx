import { cn } from '@/lib/utils';
import { productColorValue } from '@/lib/product-color';

export function colorFromProductDetail(detail: string) {
  return detail.split('·', 1)[0]?.trim() || detail;
}

export function ProductColorSwatch({
  color,
  model,
  className,
}: {
  color: string;
  model?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-4 shrink-0 rounded-full border border-black/15 shadow-[inset_0_0_0_1px_rgb(255_255_255/35%)]',
        className,
      )}
      style={{ backgroundColor: productColorValue(color, model) }}
      title={color}
    />
  );
}
