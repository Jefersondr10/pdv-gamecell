PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS tenants (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 salt TEXT NOT NULL, password_hash TEXT NOT NULL, permissions TEXT NOT NULL DEFAULT '[]',
 is_owner INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, UNIQUE(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 name TEXT NOT NULL, sku TEXT NOT NULL DEFAULT '', price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
 created_at TEXT NOT NULL, UNIQUE(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS customers (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, cpf TEXT NOT NULL DEFAULT '', UNIQUE(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS pix_accounts (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 name TEXT NOT NULL COLLATE NOCASE, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(tenant_id, id), UNIQUE(tenant_id, name)
);
CREATE TABLE IF NOT EXISTS suppliers (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 name TEXT NOT NULL COLLATE NOCASE, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(tenant_id, id), UNIQUE(tenant_id, name)
);
CREATE TABLE IF NOT EXISTS card_machines (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 name TEXT NOT NULL COLLATE NOCASE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(tenant_id, id), UNIQUE(tenant_id, name)
);
CREATE TABLE IF NOT EXISTS card_brands (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, machine_id TEXT NOT NULL,
 name TEXT NOT NULL COLLATE NOCASE, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id, machine_id) REFERENCES card_machines(tenant_id, id),
 UNIQUE(tenant_id, id), UNIQUE(tenant_id, machine_id, id), UNIQUE(tenant_id, machine_id, name)
);
CREATE TABLE IF NOT EXISTS rates (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 machine TEXT NOT NULL, brand TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('credit', 'debit')),
 installments INTEGER NOT NULL CHECK(installments >= 1), basis_points INTEGER NOT NULL CHECK(basis_points BETWEEN 0 AND 10000),
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
 machine_id TEXT NOT NULL, brand_id TEXT NOT NULL,
 FOREIGN KEY(tenant_id, machine_id) REFERENCES card_machines(tenant_id, id),
 FOREIGN KEY(tenant_id, machine_id, brand_id) REFERENCES card_brands(tenant_id, machine_id, id),
 UNIQUE(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS lots (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
 product_id TEXT NOT NULL, quantity_initial INTEGER NOT NULL CHECK(quantity_initial > 0),
 quantity_remaining INTEGER NOT NULL CHECK(quantity_remaining >= 0),
 unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents >= 0), received_at TEXT NOT NULL,
 supplier_id TEXT, supplier_name TEXT,
 FOREIGN KEY(tenant_id, product_id) REFERENCES products(tenant_id, id),
 FOREIGN KEY(tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id), UNIQUE(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS sales (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), number INTEGER NOT NULL,
 customer_id TEXT, seller_id TEXT, created_by TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'confirmed', 'cancelled')),
 freight_cents INTEGER NOT NULL DEFAULT 0 CHECK(freight_cents >= 0), expenses_json TEXT NOT NULL DEFAULT '[]',
 public_notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 confirmed_at TEXT, business_date TEXT, share_hash TEXT UNIQUE, share_expires INTEGER,
 is_wholesale INTEGER NOT NULL DEFAULT 0 CHECK(is_wholesale IN (0,1)),
 review_manual INTEGER NOT NULL DEFAULT 0 CHECK(review_manual IN (0,1)),
 FOREIGN KEY(tenant_id, customer_id) REFERENCES customers(tenant_id, id),
 FOREIGN KEY(tenant_id, seller_id) REFERENCES users(tenant_id, id),
 FOREIGN KEY(tenant_id, created_by) REFERENCES users(tenant_id, id),
 UNIQUE(tenant_id, number), UNIQUE(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS sale_items (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, sale_id TEXT NOT NULL, product_id TEXT,
 description TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0),
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0), manual_cost_cents INTEGER CHECK(manual_cost_cents >= 0),
 ordinal INTEGER NOT NULL,
 FOREIGN KEY(tenant_id, sale_id) REFERENCES sales(tenant_id, id),
 FOREIGN KEY(tenant_id, product_id) REFERENCES products(tenant_id, id), UNIQUE(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS sale_cancellations (
 tenant_id TEXT NOT NULL, sale_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 reason TEXT NOT NULL, created_at TEXT NOT NULL, snapshot_json TEXT NOT NULL,
 PRIMARY KEY(tenant_id,sale_id),
 FOREIGN KEY(tenant_id,sale_id) REFERENCES sales(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS sale_refunds (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, sale_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 actor_name_snapshot TEXT NOT NULL DEFAULT '',
 request_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 method TEXT NOT NULL CHECK(method IN ('pix','cash','card','other')),
 refunded_date TEXT NOT NULL CHECK(length(refunded_date)=10), notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,request_id),
 FOREIGN KEY(tenant_id,sale_id) REFERENCES sale_cancellations(tenant_id,sale_id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE TRIGGER IF NOT EXISTS trg_sale_refunds_immutable_update
BEFORE UPDATE ON sale_refunds BEGIN SELECT RAISE(ABORT,'sale refunds are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_sale_refunds_immutable_delete
BEFORE DELETE ON sale_refunds BEGIN SELECT RAISE(ABORT,'sale refunds are immutable'); END;
CREATE INDEX IF NOT EXISTS idx_sale_refunds_sale ON sale_refunds(tenant_id,sale_id,refunded_date,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_refunds_tenant_sale_id ON sale_refunds(tenant_id,sale_id,id);
CREATE TABLE IF NOT EXISTS sale_refund_reversals (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, sale_id TEXT NOT NULL, refund_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, actor_name_snapshot TEXT NOT NULL, request_id TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 reversed_date TEXT NOT NULL CHECK(length(reversed_date)=10), created_at TEXT NOT NULL,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,refund_id), UNIQUE(tenant_id,request_id),
 FOREIGN KEY(tenant_id,sale_id) REFERENCES sale_cancellations(tenant_id,sale_id),
 FOREIGN KEY(tenant_id,sale_id,refund_id) REFERENCES sale_refunds(tenant_id,sale_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE TRIGGER IF NOT EXISTS trg_sale_refund_reversals_immutable_update
BEFORE UPDATE ON sale_refund_reversals BEGIN SELECT RAISE(ABORT,'sale refund reversals are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_sale_refund_reversals_immutable_delete
BEFORE DELETE ON sale_refund_reversals BEGIN SELECT RAISE(ABORT,'sale refund reversals are immutable'); END;
CREATE INDEX IF NOT EXISTS idx_sale_refund_reversals_sale ON sale_refund_reversals(tenant_id,sale_id,reversed_date,created_at);
CREATE TABLE IF NOT EXISTS allocations (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, item_id TEXT NOT NULL, lot_id TEXT,
 quantity INTEGER NOT NULL CHECK(quantity > 0), unit_cost_cents INTEGER CHECK(unit_cost_cents >= 0),
 FOREIGN KEY(tenant_id, item_id) REFERENCES sale_items(tenant_id, id),
 FOREIGN KEY(tenant_id, lot_id) REFERENCES lots(tenant_id, id),
 CHECK((lot_id IS NULL AND unit_cost_cents IS NULL) OR (lot_id IS NOT NULL AND unit_cost_cents IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS payments (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, sale_id TEXT NOT NULL,
 method TEXT NOT NULL CHECK(method IN ('pix', 'cash', 'card')), amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 machine TEXT, brand TEXT, mode TEXT, installments INTEGER, basis_points INTEGER NOT NULL DEFAULT 0,
 fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(fee_cents >= 0), created_at TEXT NOT NULL,
 pix_account_id TEXT, pix_account_name TEXT,
 FOREIGN KEY(tenant_id, sale_id) REFERENCES sales(tenant_id, id),
 FOREIGN KEY(tenant_id, pix_account_id) REFERENCES pix_accounts(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS payment_requests (
 tenant_id TEXT NOT NULL REFERENCES tenants(id), request_id TEXT NOT NULL,
 sale_id TEXT NOT NULL, payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),
 payload_hash TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id, request_id),
 FOREIGN KEY(tenant_id, sale_id) REFERENCES sales(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_sale_identity ON payments(tenant_id,sale_id,id);
CREATE TABLE IF NOT EXISTS payment_changes (
 tenant_id TEXT NOT NULL, sale_id TEXT NOT NULL, payment_id TEXT NOT NULL,
 replacement_id TEXT, reason TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,payment_id), UNIQUE(tenant_id,replacement_id),
 CHECK(replacement_id IS NULL OR replacement_id<>payment_id),
 FOREIGN KEY(tenant_id,sale_id,payment_id) REFERENCES payments(tenant_id,sale_id,id),
 FOREIGN KEY(tenant_id,sale_id,replacement_id) REFERENCES payments(tenant_id,sale_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS sale_statuses (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 name TEXT NOT NULL COLLATE NOCASE,
 color TEXT NOT NULL DEFAULT 'neutral' CHECK(color IN ('neutral', 'blue', 'green', 'amber', 'red', 'purple') OR
   (length(color)=7 AND substr(color,1,1)='#' AND substr(color,2) NOT GLOB '*[^0-9a-fA-F]*')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(tenant_id, id), UNIQUE(tenant_id, name)
);
CREATE TABLE IF NOT EXISTS sale_status_assignments (
 tenant_id TEXT NOT NULL, sale_id TEXT NOT NULL, status_id TEXT NOT NULL,
 assigned_by TEXT NOT NULL, assigned_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id, sale_id),
 FOREIGN KEY(tenant_id, sale_id) REFERENCES sales(tenant_id, id),
 FOREIGN KEY(tenant_id, status_id) REFERENCES sale_statuses(tenant_id, id),
 FOREIGN KEY(tenant_id, assigned_by) REFERENCES users(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS audit (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), actor_id TEXT NOT NULL,
 entity TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, data_json TEXT NOT NULL,
 created_at TEXT NOT NULL, FOREIGN KEY(tenant_id, actor_id) REFERENCES users(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_lots_fifo ON lots(tenant_id, product_id, received_at);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(tenant_id, business_date);
CREATE INDEX IF NOT EXISTS idx_items_sale ON sale_items(tenant_id, sale_id);
CREATE INDEX IF NOT EXISTS idx_items_product ON sale_items(tenant_id, product_id);
CREATE TABLE IF NOT EXISTS stock_entry_state (
 tenant_id TEXT NOT NULL, lot_id TEXT NOT NULL, version INTEGER NOT NULL,
 voided_at TEXT, reason TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,lot_id), FOREIGN KEY(tenant_id,lot_id) REFERENCES lots(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS operation_requests (
 tenant_id TEXT NOT NULL REFERENCES tenants(id), request_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 result_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(tenant_id,request_id)
);
CREATE TABLE IF NOT EXISTS sale_fifo_order (
 tenant_id TEXT NOT NULL, sale_id TEXT NOT NULL, sequence INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,sale_id), UNIQUE(tenant_id,sequence),
 FOREIGN KEY(tenant_id,sale_id) REFERENCES sales(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS sale_item_details (
 tenant_id TEXT NOT NULL, item_id TEXT NOT NULL,
 serial_number TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '',
 share_details INTEGER NOT NULL DEFAULT 0 CHECK(share_details IN (0,1)),
 PRIMARY KEY(tenant_id,item_id),
 FOREIGN KEY(tenant_id,item_id) REFERENCES sale_items(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_alloc_item ON allocations(tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(tenant_id, sale_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_sale ON payment_requests(tenant_id, sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_status_assignments_status ON sale_status_assignments(tenant_id, status_id);
CREATE TABLE IF NOT EXISTS inventory_units (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, lot_id TEXT NOT NULL,
 serial_number TEXT NOT NULL, serial_key TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 FOREIGN KEY(tenant_id,lot_id) REFERENCES lots(tenant_id,id),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,serial_key)
);
CREATE INDEX IF NOT EXISTS idx_inventory_units_lot ON inventory_units(tenant_id,lot_id,active);
CREATE TABLE IF NOT EXISTS sale_item_tracking (
 tenant_id TEXT NOT NULL, item_id TEXT NOT NULL, PRIMARY KEY(tenant_id,item_id),
 FOREIGN KEY(tenant_id,item_id) REFERENCES sale_items(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS sale_item_units (
 tenant_id TEXT NOT NULL, item_id TEXT NOT NULL, unit_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,item_id,unit_id),
 FOREIGN KEY(tenant_id,item_id) REFERENCES sale_item_tracking(tenant_id,item_id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,unit_id) REFERENCES inventory_units(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_sale_item_units_unit ON sale_item_units(tenant_id,unit_id);
