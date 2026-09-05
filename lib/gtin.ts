export function hasValidGtinCheckDigit(value: string) {
  if (!/^\d{8}$|^\d{12,14}$/.test(value)) return false;
  const digits = value.split('').map(Number);
  const suppliedCheckDigit = digits.pop();
  const total = digits
    .reverse()
    .reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 3 : 1), 0);
  return suppliedCheckDigit === (10 - (total % 10)) % 10;
}

export function expandUpce(value: string) {
  if (!/^\d{8}$/.test(value)) return null;
  const [numberSystem, first, second, third, fourth, fifth, expansion, check] =
    value.split('');
  if (numberSystem !== '0' && numberSystem !== '1') return null;

  let body: string;
  if ('012'.includes(expansion)) {
    body = `${numberSystem}${first}${second}${expansion}0000${third}${fourth}${fifth}`;
  } else if (expansion === '3') {
    body = `${numberSystem}${first}${second}${third}00000${fourth}${fifth}`;
  } else if (expansion === '4') {
    body = `${numberSystem}${first}${second}${third}${fourth}00000${fifth}`;
  } else {
    body = `${numberSystem}${first}${second}${third}${fourth}${fifth}0000${expansion}`;
  }

  const expanded = body + check;
  return hasValidGtinCheckDigit(expanded) ? expanded : null;
}

export function normalizeCommercialCode(value: string) {
  const digits = value.replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(digits.length)) return '';
  if (hasValidGtinCheckDigit(digits)) return digits.padStart(14, '0');

  // Um UPC-E usa oito dígitos, mas o dígito verificador pertence ao UPC-A
  // expandido. Aceitamos a digitação impressa e usamos a mesma chave da câmera.
  if (digits.length === 8) {
    return expandUpce(digits)?.padStart(14, '0') ?? '';
  }
  return '';
}

export function classifyCommercialCode(value: string, normalized: string) {
  const digits = value.replace(/\D/g, '');
  if (
    digits.length === 12 ||
    (digits.length === 13 && digits.startsWith('0')) ||
    (digits.length === 8 && normalized !== digits.padStart(14, '0'))
  ) {
    return 'UPC';
  }
  if (digits.length === 13 && /^(45|49)/.test(digits)) return 'JAN';
  return 'EAN';
}
