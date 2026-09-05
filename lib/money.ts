export function parseMoneyInput(value: string) {
  const compact = value.trim().replace(/[^\d.,]/g, '');
  if (!compact || !/\d/.test(compact)) return 0;
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  const lastSeparator = Math.max(lastComma, lastDot);
  const hasBoth = lastComma >= 0 && lastDot >= 0;
  const trailingDigits =
    lastSeparator >= 0 ? compact.length - lastSeparator - 1 : 0;
  const decimalIndex =
    lastSeparator >= 0 &&
    (hasBoth || trailingDigits === 1 || trailingDigits === 2)
      ? lastSeparator
      : -1;
  if (decimalIndex < 0 && lastSeparator >= 0) {
    const groupedInteger = compact.replaceAll(',', '.');
    if (!/^\d{1,3}(?:\.\d{3})+$/.test(groupedInteger)) return 0;
  }
  const integerDigits = (
    decimalIndex >= 0 ? compact.slice(0, decimalIndex) : compact
  ).replace(/[.,]/g, '');
  const fractionDigits =
    decimalIndex >= 0 ? compact.slice(decimalIndex + 1) : '';
  if (
    !/^\d+$/.test(integerDigits || '0') ||
    (decimalIndex >= 0 && !/^\d{1,2}$/.test(fractionDigits))
  ) {
    return 0;
  }
  const cents =
    Number(integerDigits || '0') * 100 +
    Number((fractionDigits || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : 0;
}
