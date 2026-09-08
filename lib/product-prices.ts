import { parseMoneyInput } from './money.ts';

export type ProductPriceChange = {
  productId: string;
  expectedPriceCents: number;
  defaultPriceCents: number;
};

export function priceInput(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function changedProductPrices(
  baseline: Record<string, number>,
  draft: Record<string, string>,
): ProductPriceChange[] {
  return Object.entries(draft).flatMap(([productId, value]) => {
    // An empty/invalid field is never silently interpreted as a zero price.
    if (
      !/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(value.trim()) &&
      !/^\d+\.\d{1,2}$/.test(value.trim())
    ) {
      throw new Error(
        'Preencha os preços com números. Para deixar sem preço, informe 0.',
      );
    }
    const cents = parseMoneyInput(value);
    if (cents > 1_000_000_000)
      throw new Error('Um dos preços está acima do limite permitido.');
    const previous = baseline[productId];
    if (previous === undefined || previous === cents) return [];
    return [
      { productId, expectedPriceCents: previous, defaultPriceCents: cents },
    ];
  });
}
