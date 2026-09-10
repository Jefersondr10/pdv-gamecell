CREATE TABLE IF NOT EXISTS expense_batches (
 id TEXT NOT NULL, tenant_id TEXT NOT NULL REFERENCES tenants(id), payload_hash TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS operating_expenses (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), batch_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL, description TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('fixed','variable')),
 category TEXT NOT NULL DEFAULT '', payee TEXT NOT NULL DEFAULT '', amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 reference_month TEXT NOT NULL, due_date TEXT NOT NULL, reminder_days INTEGER NOT NULL DEFAULT 3 CHECK(reminder_days BETWEEN 0 AND 30),
 notes TEXT NOT NULL DEFAULT '', paid_date TEXT, payment_note TEXT NOT NULL DEFAULT '',
 voided_at TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,batch_id) REFERENCES expense_batches(tenant_id,id),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,batch_id,ordinal), CHECK(paid_date IS NULL OR voided_at IS NULL)
);
CREATE TABLE IF NOT EXISTS finance_settings (
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id), reserve_basis_points INTEGER NOT NULL DEFAULT 10000,
 partners_json TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
 CHECK(reserve_basis_points BETWEEN 0 AND 10000)
);
CREATE TABLE IF NOT EXISTS finance_closures (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), reference_month TEXT NOT NULL,
 snapshot_json TEXT NOT NULL, source_hash TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,created_by) REFERENCES users(tenant_id,id),
 UNIQUE(tenant_id,reference_month), UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS profit_withdrawals (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, closure_id TEXT NOT NULL, partner_id TEXT NOT NULL,
 request_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0), paid_date TEXT NOT NULL,
 notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,closure_id) REFERENCES finance_closures(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES users(tenant_id,id), UNIQUE(tenant_id,request_id)
);
CREATE INDEX IF NOT EXISTS idx_expenses_month ON operating_expenses(tenant_id,reference_month);
CREATE INDEX IF NOT EXISTS idx_expenses_due_open ON operating_expenses(tenant_id,due_date) WHERE paid_date IS NULL AND voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_withdrawals_closure ON profit_withdrawals(tenant_id,closure_id);
CREATE TABLE IF NOT EXISTS expense_categories (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL,
 name_key TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#9756F4', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,name_key)
);
CREATE TABLE IF NOT EXISTS expense_category_links (
 tenant_id TEXT NOT NULL, expense_id TEXT NOT NULL, category_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,expense_id),
 FOREIGN KEY(tenant_id,expense_id) REFERENCES operating_expenses(tenant_id,id),
 FOREIGN KEY(tenant_id,category_id) REFERENCES expense_categories(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_expense_category_links_category ON expense_category_links(tenant_id,category_id);
PRAGMA optimize;
CREATE TABLE IF NOT EXISTS expense_category_scopes (
 tenant_id TEXT NOT NULL, category_id TEXT NOT NULL,
 applicability TEXT NOT NULL CHECK(applicability IN ('fixed','variable','both')),
 PRIMARY KEY(tenant_id,category_id),
 FOREIGN KEY(tenant_id,category_id) REFERENCES expense_categories(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS expense_subcategories (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, category_id TEXT NOT NULL,
 name TEXT NOT NULL, name_key TEXT NOT NULL,
 applicability TEXT NOT NULL DEFAULT 'both' CHECK(applicability IN ('fixed','variable','both')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,category_id) REFERENCES expense_categories(tenant_id,id),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,category_id,id), UNIQUE(tenant_id,category_id,name_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_category_link_parent ON expense_category_links(tenant_id,expense_id,category_id);
CREATE TABLE IF NOT EXISTS expense_subcategory_links (
 tenant_id TEXT NOT NULL, expense_id TEXT NOT NULL, category_id TEXT NOT NULL, subcategory_id TEXT NOT NULL,
 name TEXT NOT NULL,
 PRIMARY KEY(tenant_id,expense_id),
 FOREIGN KEY(tenant_id,expense_id,category_id) REFERENCES expense_category_links(tenant_id,expense_id,category_id),
 FOREIGN KEY(tenant_id,category_id,subcategory_id) REFERENCES expense_subcategories(tenant_id,category_id,id)
);
