export type ProductPriceChange = {
  productId: string;
  expectedPriceCents: number;
  defaultPriceCents: number;
};

export function parseProductPriceInput(value: string, allowEmpty = false) {
  if (!value.trim() && allowEmpty) return 0;
  const input = value.trim().replace(/^R(?:\$|S)\s*/i, '');
  if (
    !/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(input) &&
    !/^\d+\.\d{1,2}$/.test(input)
  )
    throw new Error(
      'Preencha os preços com números. Para deixar sem preço, informe 0.',
    );
  const normalized = input.includes(',')
    ? input.replaceAll('.', '').replace(',', '.')
    : /^\d+\.\d{1,2}$/.test(input)
      ? input
      : input.replaceAll('.', '');
  const [integer, fraction = ''] = normalized.split('.');
  const cents = Number(integer) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 1_000_000_000)
    throw new Error('Um dos preços está acima do limite permitido.');
  return cents;
}

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
    const cents = parseProductPriceInput(value);
    const previous = baseline[productId];
    if (previous === undefined || previous === cents) return [];
    return [
      { productId, expectedPriceCents: previous, defaultPriceCents: cents },
    ];
  });
}
