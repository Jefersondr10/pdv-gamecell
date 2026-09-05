import { HttpError } from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';

const DAILY_STORE_LIMIT_BYTES = 256 * 1024 * 1024;
const GLOBAL_LIMIT_BYTES = 20 * 1024 * 1024 * 1024;
const RESERVATION_TTL_MS = 30 * 60 * 1000;

export async function reserveUpload(storeId: string, sizeBytes: number) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return null;
  const db = runtime().DB;
  const now = Date.now();
  const dayStart = now - 24 * 60 * 60 * 1000;
  await db
    .prepare(
      `DELETE FROM upload_reservations WHERE id IN (
         SELECT id FROM upload_reservations
         WHERE expires_at <= ? ORDER BY expires_at LIMIT 50
       )`,
    )
    .bind(now)
    .run();
  const id = crypto.randomUUID();
  const reserved = await db
    .prepare(
      `INSERT INTO upload_reservations
       (id, store_id, size_bytes, created_at, expires_at)
       SELECT ?, stores.id, ?, ?, ?
       FROM stores
       WHERE stores.id = ?
         AND ? + COALESCE((
           SELECT SUM(size_bytes) FROM attachments
           WHERE store_id = stores.id
         ), 0) + COALESCE((
           SELECT SUM(size_bytes) FROM upload_reservations
           WHERE store_id = stores.id AND expires_at > ?
         ), 0) <= stores.storage_limit_bytes
         AND ? + COALESCE((
           SELECT SUM(size_bytes) FROM attachments
           WHERE store_id = stores.id AND created_at >= ?
         ), 0) + COALESCE((
           SELECT SUM(size_bytes) FROM upload_reservations
           WHERE store_id = stores.id AND created_at >= ? AND expires_at > ?
         ), 0) <= ?
         AND ? + COALESCE((
           SELECT SUM(size_bytes) FROM attachments
         ), 0) + COALESCE((
           SELECT SUM(size_bytes) FROM upload_reservations
           WHERE expires_at > ?
         ), 0) <= ?
       RETURNING id`,
    )
    .bind(
      id,
      sizeBytes,
      now,
      now + RESERVATION_TTL_MS,
      storeId,
      sizeBytes,
      now,
      sizeBytes,
      dayStart,
      dayStart,
      now,
      DAILY_STORE_LIMIT_BYTES,
      sizeBytes,
      now,
      GLOBAL_LIMIT_BYTES,
    )
    .first<{ id: string }>();
  if (!reserved) {
    throw new HttpError(
      429,
      'O limite de armazenamento da loja ou o limite diário de anexos foi atingido.',
      'STORAGE_QUOTA',
    );
  }
  return id;
}

export async function releaseUpload(reservationId: string) {
  try {
    await runtime()
      .DB.prepare('DELETE FROM upload_reservations WHERE id = ?')
      .bind(reservationId)
      .run();
  } catch {
    // Reservas abandonadas expiram e são removidas antes do próximo envio.
  }
}
