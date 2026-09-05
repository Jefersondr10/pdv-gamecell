import { HttpError } from '@/lib/server/http';

export const PRODUCTION_RESET_MARKER = 'system:production-r2-reset-pending';
export const PRODUCTION_READY_MARKER = 'system:production-ready-v1';

export async function assertProductionReady(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT key_hash AS keyHash FROM login_attempts
       WHERE key_hash IN (?, ?)`,
    )
    .bind(PRODUCTION_RESET_MARKER, PRODUCTION_READY_MARKER)
    .all<{ keyHash: string }>();
  const markers = new Set((result.results ?? []).map((row) => row.keyHash));
  if (
    markers.has(PRODUCTION_RESET_MARKER) ||
    !markers.has(PRODUCTION_READY_MARKER)
  ) {
    throw new HttpError(
      503,
      'A produção está concluindo a limpeza inicial. Tente novamente em instantes.',
      'PRODUCTION_INITIALIZING',
    );
  }
}
