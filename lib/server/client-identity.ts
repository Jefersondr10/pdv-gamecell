import { normalizeClientName } from '../client-name.ts';
import { HttpError } from './http.ts';

// Legacy rows may have a null key. Do not backfill or merge homonyms implicitly.
// New/renamed clients claim the unique key in the same write as the client.
export async function rejectDuplicateClient(
  db: D1Database,
  storeId: string,
  name: string,
  exceptId?: string,
) {
  const key = normalizeClientName(name);
  const rows = await db
    .prepare(
      'SELECT id, name, active FROM clients WHERE store_id = ? AND (name_key = ? OR name_key IS NULL) ORDER BY active DESC, created_at, id LIMIT 5000',
    )
    .bind(storeId, key)
    .all<{ id: string; name: string; active: number }>();
  const duplicate = rows.results.find(
    (client) =>
      client.id !== exceptId && normalizeClientName(client.name) === key,
  );
  if (duplicate)
    throw new HttpError(
      409,
      `O cliente “${duplicate.name}” já está cadastrado${duplicate.active ? '' : ' e está inativo'}. Use o cadastro existente${duplicate.active ? '' : ' ou reative-o'}.`,
      'CLIENT_ALREADY_EXISTS',
      { existingId: duplicate.id, active: Boolean(duplicate.active) },
    );
}

export function isClientNameConflict(error: unknown) {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed:.*clients\.(?:store_id|name_key)/i.test(
      error.message,
    )
  );
}
