export const RESERVATION_NOW_SQL =
  "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
export function activeReservationSql(unit = 'iu') {
  return `EXISTS (SELECT 1 FROM stock_reservation_items ri JOIN stock_reservations r ON r.id=ri.reservation_id
    WHERE ri.inventory_unit_id=${unit}.id AND r.store_id=${unit}.store_id AND r.status='active' AND r.expires_at > ${RESERVATION_NOW_SQL})`;
}
export function inventoryStatusSql(unit = 'iu') {
  return `CASE WHEN ${unit}.status='available' AND ${activeReservationSql(unit)} THEN 'reserved' ELSE ${unit}.status END`;
}
