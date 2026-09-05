export function displayCommercialCode(code: string, kind?: string) {
  const digits = code.replace(/\D/g, '');
  if (!digits) return code;

  if (kind === 'UPC') return digits.slice(-12);

  const significant = digits.replace(/^0+/, '');
  if (significant.length <= 8) return digits.slice(-8);
  // Um UPC-A pode chegar do leitor como EAN-13 com um zero técnico na frente.
  // No GTIN-14 canônico isso resulta em dois zeros iniciais.
  if (digits.length === 14 && digits.startsWith('00')) return digits.slice(-12);
  if (digits.length === 14 && digits.startsWith('0')) return digits.slice(-13);
  return digits;
}
