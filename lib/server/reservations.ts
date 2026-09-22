import { HttpError, operationIdField, stringField } from './http.ts';
import type {
  ReservationRecord,
  ReservationPage,
  ReservationItem,
} from '../reservations.ts';

import { RESERVATION_NOW_SQL } from './reservation-stock.ts';
export {
  activeReservationSql,
  inventoryStatusSql,
} from './reservation-stock.ts';
export function reservationError(error: unknown): never {
  if (
    error instanceof Error &&
    /RESERVATION_UNIT_UNAVAILABLE|stock_reservations\.status|audit_events\.entity_id/.test(
      error.message,
    )
  )
    throw new HttpError(
      409,
      'A reserva ou o estoque mudou. Atualize a lista antes de continuar.',
      'RESERVATION_CONFLICT',
    );
  throw error;
}
function expiry(value: unknown) {
  const expiresAt = Number(value);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > Date.now() + 90 * 86400000
  )
    throw new HttpError(
      400,
      'Escolha um prazo futuro de até 90 dias.',
      'INVALID_EXPIRY',
    );
  return expiresAt;
}
export async function listReservations(
  db: D1Database,
  storeId: string,
  url: URL,
): Promise<ReservationPage> {
  const offset = Math.min(
    100000,
    Math.max(0, Math.trunc(Number(url.searchParams.get('offset')) || 0)),
  );
  const status = url.searchParams.get('status') || 'active';
  if (!['active', 'expired', 'released', 'converted', 'all'].includes(status))
    throw new HttpError(400, 'Situação inválida.');
  const effective = `CASE WHEN r.status='active' AND r.expires_at<=${RESERVATION_NOW_SQL} THEN 'expired' ELSE r.status END`;
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
  const result = await db
    .prepare(`SELECT r.id,r.customer_id AS customerId,r.customer_name AS customerName,
    u.display_name AS operatorName,r.expires_at AS expiresAt,r.created_at AS createdAt,${effective} AS status,
    r.sale_id AS saleId,s.number AS saleNumber,r.notes,r.revision
    FROM stock_reservations r JOIN users u ON u.id=r.created_by AND u.store_id=r.store_id
    LEFT JOIN sales s ON s.id=r.sale_id AND s.store_id=r.store_id
    WHERE r.store_id=? AND (?='all' OR ${effective}=?) AND (r.customer_name LIKE ? OR EXISTS (
      SELECT 1 FROM stock_reservation_items ri JOIN inventory_units iu ON iu.id=ri.inventory_unit_id
      WHERE ri.reservation_id=r.id AND iu.serial LIKE ?))
    ORDER BY r.created_at DESC,r.id DESC LIMIT 31 OFFSET ?`)
    .bind(storeId, status, status, `%${q}%`, `%${q}%`, offset)
    .all<Omit<ReservationRecord, 'items'>>();
  const rows = result.results.slice(0, 30);
  const items = rows.length
    ? (
        await db
          .prepare(`SELECT ri.reservation_id AS reservationId,iu.id AS unitId,iu.serial,
    p.model AS product,(p.color || ' · ' || p.memory) AS detail,p.default_price_cents AS defaultPriceCents
    FROM stock_reservation_items ri JOIN inventory_units iu ON iu.id=ri.inventory_unit_id AND iu.store_id=?
    JOIN products p ON p.id=iu.product_id AND p.store_id=iu.store_id
    WHERE ri.reservation_id IN (${rows.map(() => '?').join(',')}) ORDER BY iu.serial`)
          .bind(storeId, ...rows.map((r) => r.id))
          .all<ReservationItem & { reservationId: string }>()
      ).results
    : [];
  return {
    items: rows.map((row) => ({
      ...row,
      items: items.filter((item) => item.reservationId === row.id),
    })),
    nextOffset: result.results.length > 30 ? offset + 30 : null,
  };
}
export async function createReservation(
  db: D1Database,
  storeId: string,
  actorId: string,
  body: Record<string, unknown>,
) {
  const id = operationIdField(body.operationId);
  const customerId = stringField(body.customerId, 'Cliente', { max: 80 });
  if (
    !Array.isArray(body.unitIds) ||
    !body.unitIds.length ||
    body.unitIds.length > 50 ||
    body.unitIds.some((v) => typeof v !== 'string' || v.length > 80)
  )
    throw new HttpError(400, 'Selecione de 1 a 50 aparelhos.', 'INVALID_ITEMS');
  const unitIds = [...new Set(body.unitIds as string[])].sort();
  if (unitIds.length !== body.unitIds.length)
    throw new HttpError(400, 'Há aparelhos repetidos.');
  const notes =
    typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : '';
  const fingerprint = JSON.stringify([
    customerId,
    unitIds,
    body.expiresAt,
    notes,
  ]);
  const existing = await db
    .prepare(
      'SELECT fingerprint FROM stock_reservations WHERE id=? AND store_id=?',
    )
    .bind(id, storeId)
    .first<{ fingerprint: string }>();
  if (existing) {
    if (existing.fingerprint !== fingerprint)
      throw new HttpError(
        409,
        'Este envio já foi usado para outra reserva. Atualize a lista.',
      );
    return { id, replayed: true };
  }
  const expiresAt = expiry(body.expiresAt),
    now = Date.now();
  const customer = await db
    .prepare('SELECT name FROM clients WHERE id=? AND store_id=? AND active=1')
    .bind(customerId, storeId)
    .first<{ name: string }>();
  if (!customer) throw new HttpError(404, 'Cliente ativo não encontrado.');
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO stock_reservations(id,store_id,customer_id,customer_name,created_by,expires_at,notes,fingerprint,created_at,updated_at)
        SELECT ?,?,?,name,?,?,?,?,?,? FROM clients WHERE id=? AND store_id=? AND active=1`)
        .bind(
          id,
          storeId,
          customerId,
          actorId,
          expiresAt,
          notes,
          fingerprint,
          now,
          now,
          customerId,
          storeId,
        ),
      ...unitIds.map((unitId) =>
        db
          .prepare(
            'INSERT INTO stock_reservation_items(reservation_id,inventory_unit_id) VALUES(?,?)',
          )
          .bind(id, unitId),
      ),
      db
        .prepare(`INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
        VALUES(?,?,?,'reservation.created','reservation',?,?,?)`)
        .bind(
          crypto.randomUUID(),
          storeId,
          actorId,
          id,
          JSON.stringify({
            customerName: customer.name,
            expiresAt,
            items: unitIds.length,
          }),
          now,
        ),
    ]);
  } catch (error) {
    const saved = await db
      .prepare(
        'SELECT fingerprint FROM stock_reservations WHERE id=? AND store_id=?',
      )
      .bind(id, storeId)
      .first<{ fingerprint: string }>();
    if (saved?.fingerprint === fingerprint) return { id, replayed: true };
    reservationError(error);
  }
  return { id, replayed: false };
}
export async function changeReservation(
  db: D1Database,
  storeId: string,
  actorId: string,
  id: string,
  body: Record<string, unknown>,
) {
  const row = await db
    .prepare(
      'SELECT status,expires_at AS expiresAt,revision FROM stock_reservations WHERE id=? AND store_id=?',
    )
    .bind(id, storeId)
    .first<{ status: string; expiresAt: number; revision: number }>();
  if (!row) throw new HttpError(404, 'Reserva não encontrada.');
  if (!['release', 'deadline'].includes(String(body.action)))
    throw new HttpError(400, 'Ação inválida.');
  if (body.action === 'release' && row.status === 'released')
    return { ok: true };
  if (
    row.status !== 'active' ||
    row.expiresAt <= Date.now() ||
    body.revision !== row.revision
  )
    throw new HttpError(409, 'A reserva mudou ou venceu. Atualize a lista.');
  const nextExpiry =
    body.action === 'deadline' ? expiry(body.expiresAt) : row.expiresAt;
  const nextStatus = body.action === 'release' ? 'released' : 'active';
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE stock_reservations SET status=?,expires_at=?,revision=revision+1,updated_at=? WHERE id=? AND store_id=? AND revision=? AND status='active' AND expires_at>${RESERVATION_NOW_SQL}`,
        )
        .bind(nextStatus, nextExpiry, Date.now(), id, storeId, row.revision),
      db
        .prepare(`INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
      VALUES(?,?,?,?,'reservation',CASE WHEN changes()=1 THEN ? ELSE NULL END,?,?)`)
        .bind(
          crypto.randomUUID(),
          storeId,
          actorId,
          `reservation.${String(body.action)}`,
          id,
          JSON.stringify({ before: row.expiresAt, after: nextExpiry }),
          Date.now(),
        ),
    ]);
  } catch (error) {
    reservationError(error);
  }
  return { ok: true };
}
export async function validateReservationSale(
  db: D1Database,
  storeId: string,
  id: string,
  customerId: string,
  unitIds: string[],
) {
  const row = await db
    .prepare(
      `SELECT customer_id AS customerId,status,expires_at AS expiresAt,revision FROM stock_reservations WHERE id=? AND store_id=?`,
    )
    .bind(id, storeId)
    .first<{
      customerId: string;
      status: string;
      expiresAt: number;
      revision: number;
    }>();
  if (!row) throw new HttpError(404, 'Reserva não encontrada.');
  const items = (
    await db
      .prepare(
        'SELECT inventory_unit_id AS id FROM stock_reservation_items WHERE reservation_id=?',
      )
      .bind(id)
      .all<{ id: string }>()
  ).results;
  if (
    row.status !== 'active' ||
    row.expiresAt <= Date.now() ||
    row.customerId !== customerId ||
    items.length !== unitIds.length ||
    items.some((item) => !unitIds.includes(item.id))
  )
    throw new HttpError(
      409,
      'A reserva venceu, foi alterada ou os aparelhos/cliente não correspondem. Atualize Reservas.',
      'RESERVATION_CONFLICT',
    );
  return row.revision;
}
export function convertReservationStatement(
  db: D1Database,
  storeId: string,
  id: string,
  saleId: string,
  revision: number,
) {
  return db
    .prepare(`UPDATE stock_reservations SET status=CASE WHEN status='active' AND expires_at>${RESERVATION_NOW_SQL} AND revision=? THEN 'converted' ELSE NULL END,
    sale_id=?,revision=revision+1,updated_at=? WHERE id=? AND store_id=?`)
    .bind(revision, saleId, Date.now(), id, storeId);
}
