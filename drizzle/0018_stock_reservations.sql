CREATE TABLE stock_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL REFERENCES stores(id),
  customer_id TEXT NOT NULL REFERENCES clients(id),
  customer_name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','released','converted')),
  sale_id TEXT REFERENCES sales(id),
  notes TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_stock_reservations_store ON stock_reservations(store_id, status, expires_at);
CREATE TABLE stock_reservation_items (
  reservation_id TEXT NOT NULL REFERENCES stock_reservations(id),
  inventory_unit_id TEXT NOT NULL REFERENCES inventory_units(id),
  PRIMARY KEY(reservation_id, inventory_unit_id)
);
CREATE INDEX idx_stock_reservation_unit ON stock_reservation_items(inventory_unit_id);
-- Serialize claims with sales inside the same database transaction. Expired
-- holds stop blocking immediately, even when no browser or background job runs.
CREATE TRIGGER stock_reservation_claim BEFORE INSERT ON stock_reservation_items
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM inventory_units iu JOIN stock_reservations r ON r.id=NEW.reservation_id
    WHERE iu.id=NEW.inventory_unit_id AND iu.store_id=r.store_id AND iu.status='available'
      AND r.status='active' AND r.expires_at > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
  ) THEN RAISE(ABORT, 'RESERVATION_UNIT_UNAVAILABLE') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM stock_reservation_items ri JOIN stock_reservations r ON r.id=ri.reservation_id
    WHERE ri.inventory_unit_id=NEW.inventory_unit_id AND r.status='active'
      AND r.expires_at > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
  ) THEN RAISE(ABORT, 'RESERVATION_UNIT_UNAVAILABLE') END;
END;
CREATE TRIGGER stock_reservation_sale_guard BEFORE UPDATE OF status, sale_id ON inventory_units
WHEN NEW.status='sold' AND EXISTS (
  SELECT 1 FROM stock_reservation_items ri JOIN stock_reservations r ON r.id=ri.reservation_id
  WHERE ri.inventory_unit_id=NEW.id AND r.store_id=NEW.store_id AND r.status='active'
    AND r.expires_at > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
)
BEGIN
  SELECT RAISE(ABORT, 'RESERVATION_UNIT_UNAVAILABLE');
END;
