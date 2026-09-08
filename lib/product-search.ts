export function matchesProductSearch(
  product: {
    model: string;
    color: string;
    memory: string;
    codes: Array<{ code: string }>;
  },
  query: string,
) {
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  const text = normalize(
    [
      product.model,
      product.color,
      product.memory,
      ...product.codes.flatMap(({ code }) => [code, code.padStart(13, '0')]),
    ].join(' '),
  );
  return query
    .trim()
    .split(/\s+/)
    .map(normalize)
    .every((term) => text.includes(term));
}
