import { HttpError } from './http.ts';

// These maps are owned by the server; no request value becomes an SQL identifier.
export const PRODUCT_EDIT_COLUMNS = {
  model: 'model',
  color: 'color',
  memory: 'memory',
  defaultPriceCents: 'default_price_cents',
} as const;
export const CLIENT_EDIT_COLUMNS = {
  name: 'name',
  phone: 'phone',
  email: 'email',
  notes: 'notes',
} as const;

export function catalogChanged() {
  return new HttpError(
    409,
    'Este cadastro mudou ou foi aberto em uma versão antiga. Reabra o cadastro e confira os dados antes de salvar. Nenhuma alteração foi salva.',
    'CATALOG_CHANGED',
  );
}

export function catalogEditGuard(
  expected: unknown,
  changed: Record<string, unknown>,
  columns: Record<string, string>,
  alias: string,
) {
  const fields = Object.keys(columns).filter((key) => key in changed);
  if (!fields.length) return { sql: '', bindings: [] as unknown[] };
  if (!expected || typeof expected !== 'object' || Array.isArray(expected))
    throw catalogChanged();
  const values = expected as Record<string, unknown>;
  if (
    Object.keys(values).some((key) => !fields.includes(key)) ||
    fields.some((key) => {
      const value = values[key];
      return (
        !(key in values) ||
        (value !== null && !['string', 'number'].includes(typeof value)) ||
        (typeof value === 'number' && !Number.isSafeInteger(value))
      );
    })
  )
    throw catalogChanged();
  return {
    // Accept an identical retry after a lost response, but not a different edit.
    sql: fields
      .map(
        (key) =>
          ` AND (${alias}.${columns[key]} IS ? OR ${alias}.${columns[key]} IS ?)`,
      )
      .join(''),
    bindings: fields.flatMap((key) => [values[key], changed[key]]),
  };
}
