import { cn } from '@/lib/utils';

const NAMED_COLORS: Array<[RegExp, string]> = [
  [/laranja|orange|coral/, '#f97316'],
  [/ultramarino|ultramarine/, '#3158c7'],
  [/azul[- ]?ceu|sky blue/, '#8fc9e8'],
  [/azul[- ]?nevoa|mist blue/, '#9cb9c8'],
  [/azul|blue/, '#3b82f6'],
  [/salvia|sage/, '#9aaa86'],
  [/verde|green/, '#4f8f69'],
  [/rosa|pink/, '#ec7fa5'],
  [/amarelo|yellow/, '#eab308'],
  [/vermelho|red/, '#dc2626'],
  [/roxo|purple|violeta/, '#8b5cf6'],
  [/meia[- ]?noite|midnight|preto|black/, '#202733'],
  [/branco[- ]?nuvem|cloud white/, '#f8f9f6'],
  [/branco estelar|starlight|branco|white/, '#f7f3e8'],
  [/prata|silver/, '#cbd5e1'],
  [/dourado|gold/, '#c8a15a'],
  [/grafite|graphite|cinza|gray|grey/, '#6b7280'],
  [/deserto|desert/, '#c98f64'],
  [/natural/, '#b4a692'],
];

export function productColorValue(color: string) {
  const normalized = color
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const known = NAMED_COLORS.find(([pattern]) => pattern.test(normalized));
  if (known) return known[1];

  let hash = 0;
  for (const character of normalized) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return `hsl(${hash % 360} 55% 58%)`;
}

export function colorFromProductDetail(detail: string) {
  return detail.split('·', 1)[0]?.trim() || detail;
}

export function ProductColorSwatch({
  color,
  className,
}: {
  color: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-4 shrink-0 rounded-full border border-black/15 shadow-[inset_0_0_0_1px_rgb(255_255_255/35%)]',
        className,
      )}
      style={{ backgroundColor: productColorValue(color) }}
      title={color}
    />
  );
}
