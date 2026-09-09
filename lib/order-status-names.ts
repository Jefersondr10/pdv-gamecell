// Shared with the persisted name_normalized key, so SQL and UI reserve the same names.
export function normalizeOrderStatusName(value: string) {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('pt-BR');
}
