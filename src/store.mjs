import { DatabaseSync } from 'node:sqlite';
import { Finance, validDate } from './finance.mjs';
import { Operations } from './operations.mjs';
import { migrateCancellationStatus, cancelledSale, pendingRefunds } from './sale-cancellation.mjs';
import { migrateGoogleUsers, googleLogin } from './google-store.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { AppError, check, integer, text, feeCents, sumMoney, saleTotal, reconcile, planFIFO,
  PERMISSIONS, allowed, requirePermission, businessDate, publicSale, itemFinancials } from './domain.mjs';

const id = () => randomUUID();
const now = () => new Date().toISOString();
const hash = value => createHash('sha256').update(value).digest('hex');
const paymentPayloadHash = ({ saleId, method, amount, rateId, pixAccountId, pixAccountName }) => hash(JSON.stringify({
  sale_id: saleId, method, amount_cents: amount, rate_id: rateId,
  pix_account_id: pixAccountId, pix_account_name: pixAccountName
}));
const legacyPaymentPayloadHash = ({ saleId, method, amount, rateId }) => hash(JSON.stringify({
  sale_id: saleId, method, amount_cents: amount, rate_id: rateId
}));
const SALE_STATUS_COLORS = new Set(['neutral', 'blue', 'green', 'amber', 'red', 'purple']);
function credentials(password) {
  check(typeof password === 'string' && password.length >= 12 && password.length <= 128,
    'Use uma senha com 12 a 128 caracteres.');
  const salt = randomBytes(16).toString('hex');
  return { salt, password_hash: scryptSync(password, salt, 64).toString('hex') };
}
function emailAddress(value) {
  const email = text(value, 'E-mail', 254).toLowerCase();
  check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'E-mail inválido.');
  return email;
}
function optionalEmailAddress(value) {
  const email = text(value, 'E-mail', 254, false).toLowerCase();
  if (email) check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'E-mail inválido.');
  return email;
}
function optionalCpf(value) {
  if (value === undefined || value === null || value === '') return '';
  check(typeof value === 'string' && value.length <= 20, 'CPF inválido.');
  if (!value.trim()) return '';
  check(/^[\d.\-\s]+$/.test(value), 'CPF inválido.');
  const cpf = value.replace(/[.\-\s]/g, '');
  check(/^\d{11}$/.test(cpf) && !/^(\d)\1{10}$/.test(cpf), 'CPF inválido.');
  for (const length of [9, 10]) {
    const total = [...cpf.slice(0, length)].reduce((sum, digit, index) => sum + Number(digit) * (length + 1 - index), 0);
    const digit = (total * 10) % 11;
    check(Number(cpf[length]) === (digit === 10 ? 0 : digit), 'CPF inválido.');
  }
  return cpf;
}
function activeFlag(value, fallback = true) {
  if (value === undefined) return !!fallback;
  check(typeof value === 'boolean', 'Situação ativa inválida.');
  return value;
}
function saleStatusColor(value, fallback = 'neutral') {
  const color = value === undefined ? fallback : text(value, 'Cor do status', 20);
  check(SALE_STATUS_COLORS.has(color) || /^#[0-9a-f]{6}$/i.test(color), 'Cor do status inválida.');
  return color.startsWith('#') ? color.toUpperCase() : color;
}
const parseUser = row => row ? { ...row, permissions: JSON.parse(row.permissions) } : null;
const safeUser = user => ({ id: user.id, name: user.name, email: user.email,
  is_owner: !!user.is_owner, permissions: user.is_owner ? PERMISSIONS : user.permissions });

export class Store {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    this.migrateAdditiveColumns();
    migrateCancellationStatus(this);
    this.migrateSaleStatusColors();
    this.migrateCardHierarchy();
    this.installCatalogIntegrityTriggers();
    this.db.exec(readFileSync(new URL('./finance-schema.sql', import.meta.url), 'utf8'));
    this.finance = new Finance(this);
    this.operations = new Operations(this);
    migrateGoogleUsers(this);
  }
  close() { this.db.close(); }
  get(sql, ...params) { return this.db.prepare(sql).get(...params); }
  all(sql, ...params) { return this.db.prepare(sql).all(...params); }
  run(sql, ...params) { return this.db.prepare(sql).run(...params); }
  migrateAdditiveColumns() {
    const ensure = (table, column, definition) => {
      if (!this.all(`PRAGMA table_info(${table})`).some(item => item.name === column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    };
    this.transaction(() => {
      ensure('payments', 'pix_account_id', 'TEXT');
      ensure('payments', 'pix_account_name', 'TEXT');
      ensure('lots', 'supplier_id', 'TEXT');
      ensure('lots', 'supplier_name', 'TEXT');
      ensure('rates', 'machine_id', 'TEXT');
      ensure('rates', 'brand_id', 'TEXT');
      ensure('customers', 'cpf', "TEXT NOT NULL DEFAULT ''");
      ensure('sales', 'is_wholesale', 'INTEGER NOT NULL DEFAULT 0 CHECK(is_wholesale IN (0,1))');
    });
  }
  migrateSaleStatusColors() {
    const definition = this.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='sale_statuses'").sql;
    if (definition.includes('GLOB')) return;
    // Rebuild the restricted CHECK while keeping IDs and the assignment foreign keys intact.
    this.db.exec('PRAGMA foreign_keys=OFF');
    try {
      this.transaction(() => {
        this.db.exec(`CREATE TABLE sale_statuses_color_upgrade (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
          name TEXT NOT NULL COLLATE NOCASE,
          color TEXT NOT NULL DEFAULT 'neutral' CHECK(color IN ('neutral','blue','green','amber','red','purple') OR
            (length(color)=7 AND substr(color,1,1)='#' AND substr(color,2) NOT GLOB '*[^0-9a-fA-F]*')),
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          UNIQUE(tenant_id,id), UNIQUE(tenant_id,name));
          INSERT INTO sale_statuses_color_upgrade SELECT * FROM sale_statuses;
          DROP TABLE sale_statuses;
          ALTER TABLE sale_statuses_color_upgrade RENAME TO sale_statuses;`);
        check(this.all('PRAGMA foreign_key_check').length === 0, 'Falha de integridade na migração de cores.');
      });
    } finally { this.db.exec('PRAGMA foreign_keys=ON'); }
  }
  ensureCardGroup(tenantId, machineName, brandName) {
    const at = now();
    let machine = this.get('SELECT * FROM card_machines WHERE tenant_id=? AND name=? COLLATE NOCASE', tenantId, machineName);
    if (!machine) {
      const key = id();
      this.run('INSERT INTO card_machines VALUES(?,?,?,?,?)', key, tenantId, machineName, at, at);
      machine = { id: key, name: machineName };
    }
    let brand = this.get(`SELECT * FROM card_brands WHERE tenant_id=? AND machine_id=? AND name=? COLLATE NOCASE`,
      tenantId, machine.id, brandName);
    if (!brand) {
      const key = id();
      this.run('INSERT INTO card_brands VALUES(?,?,?, ?,1,?,?)', key, tenantId, machine.id, brandName, at, at);
      brand = { id: key, name: brandName };
    }
    return { machine, brand };
  }
  migrateCardHierarchy() {
    this.transaction(() => {
      for (const rate of this.all('SELECT * FROM rates WHERE machine_id IS NULL OR brand_id IS NULL ORDER BY created_at,id')) {
        const { machine, brand } = this.ensureCardGroup(rate.tenant_id, rate.machine, rate.brand);
        this.run('UPDATE rates SET machine_id=?,brand_id=?,machine=?,brand=? WHERE id=? AND tenant_id=?',
          machine.id, brand.id, machine.name, brand.name, rate.id, rate.tenant_id);
      }
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_rates_card_group ON rates(tenant_id,machine_id,brand_id,mode,installments)');
    });
  }
  installCatalogIntegrityTriggers() {
    this.transaction(() => this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_rates_card_group_insert
      BEFORE INSERT ON rates WHEN NOT EXISTS (
        SELECT 1 FROM card_brands b JOIN card_machines m ON m.tenant_id=b.tenant_id AND m.id=b.machine_id
        WHERE b.tenant_id=NEW.tenant_id AND b.id=NEW.brand_id AND m.id=NEW.machine_id
      ) BEGIN SELECT RAISE(ABORT, 'invalid card machine or brand'); END;
      CREATE TRIGGER IF NOT EXISTS trg_rates_card_group_update
      BEFORE UPDATE OF tenant_id,machine_id,brand_id ON rates WHEN NOT EXISTS (
        SELECT 1 FROM card_brands b JOIN card_machines m ON m.tenant_id=b.tenant_id AND m.id=b.machine_id
        WHERE b.tenant_id=NEW.tenant_id AND b.id=NEW.brand_id AND m.id=NEW.machine_id
      ) BEGIN SELECT RAISE(ABORT, 'invalid card machine or brand'); END;
      DROP TRIGGER IF EXISTS trg_payments_pix_catalog_insert;
      CREATE TRIGGER trg_payments_pix_catalog_insert
      BEFORE INSERT ON payments WHEN
        (NEW.method='pix' AND (NEW.pix_account_id IS NULL OR NEW.pix_account_name IS NULL OR NOT EXISTS (
          SELECT 1 FROM pix_accounts p WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.pix_account_id
        )) AND NOT (NEW.pix_account_id IS NULL AND NEW.pix_account_name IS NULL AND EXISTS (
          SELECT 1 FROM payment_changes c JOIN payments p ON p.tenant_id=c.tenant_id AND p.sale_id=c.sale_id AND p.id=c.payment_id
          WHERE c.tenant_id=NEW.tenant_id AND c.sale_id=NEW.sale_id AND c.replacement_id=NEW.id
            AND p.method='pix' AND p.pix_account_id IS NULL AND p.pix_account_name IS NULL
        ))) OR (NEW.method<>'pix' AND (NEW.pix_account_id IS NOT NULL OR NEW.pix_account_name IS NOT NULL))
      BEGIN SELECT RAISE(ABORT, 'invalid pix account snapshot'); END;
      CREATE TRIGGER IF NOT EXISTS trg_payments_pix_catalog_update
      BEFORE UPDATE OF tenant_id,method,pix_account_id,pix_account_name ON payments WHEN
        (NEW.method='pix' AND (NEW.pix_account_id IS NULL OR NEW.pix_account_name IS NULL OR NOT EXISTS (
          SELECT 1 FROM pix_accounts p WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.pix_account_id
        ))) OR (NEW.method<>'pix' AND (NEW.pix_account_id IS NOT NULL OR NEW.pix_account_name IS NOT NULL))
      BEGIN SELECT RAISE(ABORT, 'invalid pix account snapshot'); END;
      CREATE TRIGGER IF NOT EXISTS trg_lots_supplier_catalog_insert
      BEFORE INSERT ON lots WHEN
        (NEW.supplier_id IS NULL)<>(NEW.supplier_name IS NULL) OR
        (NEW.supplier_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM suppliers s WHERE s.tenant_id=NEW.tenant_id AND s.id=NEW.supplier_id
        ))
      BEGIN SELECT RAISE(ABORT, 'invalid supplier snapshot'); END;
      CREATE TRIGGER IF NOT EXISTS trg_lots_supplier_catalog_update
      BEFORE UPDATE OF tenant_id,supplier_id,supplier_name ON lots WHEN
        (NEW.supplier_id IS NULL)<>(NEW.supplier_name IS NULL) OR
        (NEW.supplier_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM suppliers s WHERE s.tenant_id=NEW.tenant_id AND s.id=NEW.supplier_id
        ))
      BEGIN SELECT RAISE(ABORT, 'invalid supplier snapshot'); END;
    `));
  }
  transaction(fn) {
    const depth=this.transactionDepth??0,name='nested_'+depth;
    this.db.exec(depth?'SAVEPOINT '+name:'BEGIN IMMEDIATE');this.transactionDepth=depth+1;
    try { const result = fn(); this.db.exec(depth?'RELEASE SAVEPOINT '+name:'COMMIT'); return result; }
    catch (error) { this.db.exec(depth?'ROLLBACK TO SAVEPOINT '+name:'ROLLBACK');if(depth)this.db.exec('RELEASE SAVEPOINT '+name);throw error; }
    finally{this.transactionDepth=depth;}
  }
  audit(actor, entity, entityId, action, data = {}) {
    this.run('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)', id(), actor.tenant_id, actor.id,
      entity, entityId, action, JSON.stringify(data), now());
  }
  register(data) {
    const email = emailAddress(data.email), name = text(data.name, 'Seu nome'),
      storeName = text(data.store_name, 'Nome da loja'), auth = credentials(data.password);
    check(!this.get("SELECT id FROM users WHERE email=? AND auth_kind='password'", email), 'Não foi possível cadastrar esse e-mail.', 409);
    return this.transaction(() => {
      const tenantId = id(), userId = id();
      this.run('INSERT INTO tenants VALUES(?,?,?)', tenantId, storeName, now());
      this.run(`INSERT INTO users(id,tenant_id,name,email,salt,password_hash,permissions,is_owner,created_at)
        VALUES(?,?,?,?,?,?,?,1,?)`, userId, tenantId, name, email, auth.salt, auth.password_hash, '[]', now());
      const user = parseUser(this.get('SELECT * FROM users WHERE id=?', userId));
      this.audit(user, 'tenant', tenantId, 'registered');
      return this.newSession(user);
    });
  }
  login(data) {
    const email = emailAddress(data.email);
    check(typeof data.password === 'string' && data.password.length <= 128, 'E-mail ou senha incorretos.', 401);
    const user = parseUser(this.get("SELECT * FROM users WHERE email=? AND active=1 AND auth_kind='password'", email));
    // Executar a derivação também para e-mail inexistente reduz a diferença de tempo.
    const candidate = scryptSync(data.password, user?.salt ?? 'invalid-account-salt', 64);
    const expected = user ? Buffer.from(user.password_hash, 'hex') : Buffer.alloc(64);
    check(timingSafeEqual(candidate, expected) && !!user, 'E-mail ou senha incorretos.', 401);
    return this.newSession(user);
  }
  newSession(user) {
    const token = randomBytes(32).toString('hex');
    this.run('DELETE FROM sessions WHERE expires_at<?', Date.now());
    this.run('INSERT INTO sessions VALUES(?,?,?)', hash(token), user.id, Date.now() + 12 * 60 * 60 * 1000);
    return { token, user: safeUser(user) };
  }
  googleLogin(identity, storeName) { return googleLogin(this, identity, storeName); }
  actor(token) {
    check(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token), 'Faça login para continuar.', 401);
    const user = parseUser(this.get(`SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`, hash(token), Date.now()));
    check(user, 'Sessão expirada. Faça login novamente.', 401);
    return user;
  }
  logout(token) { if (token) this.run('DELETE FROM sessions WHERE token_hash=?', hash(token)); }
  scoped(table, itemId, actor) {
    check(['customers', 'products', 'users', 'rates', 'sales', 'sale_statuses', 'pix_accounts', 'suppliers', 'card_machines', 'card_brands'].includes(table), 'Tabela inválida.');
    const row = this.get(`SELECT * FROM ${table} WHERE id=? AND tenant_id=?`, itemId, actor.tenant_id);
    check(row, 'Registro não encontrado.', 404); return row;
  }
  saleAccess(actor, saleId) {
    const sale = this.scoped('sales', saleId, actor);
    check(allowed(actor, 'sales.view_all') || sale.seller_id === actor.id || sale.created_by === actor.id,
      'Venda não encontrada.', 404);
    return sale;
  }
  addUser(actor, data) {
    requirePermission(actor, 'users.manage');
    const email = emailAddress(data.email), name = text(data.name, 'Nome do vendedor'), auth = credentials(data.password);
    check(Array.isArray(data.permissions), 'Permissões inválidas.');
    const permissions = [...new Set(data.permissions)];
    check(permissions.every(p => PERMISSIONS.includes(p) && allowed(actor, p)),
      'Permissões inválidas ou superiores às suas.');
    check(!this.get("SELECT id FROM users WHERE email=? AND auth_kind='password'", email), 'Não foi possível cadastrar esse e-mail.', 409);
    return this.transaction(() => {
      const userId = id();
      this.run(`INSERT INTO users(id,tenant_id,name,email,salt,password_hash,permissions,is_owner,created_at)
        VALUES(?,?,?,?,?,?,?,0,?)`, userId, actor.tenant_id, name, email, auth.salt, auth.password_hash, JSON.stringify(permissions), now());
      this.audit(actor, 'user', userId, 'created', { permissions });
      return safeUser(parseUser(this.scoped('users', userId, actor)));
    });
  }
  updatePermissions(actor, userId, data) {
    requirePermission(actor, 'users.manage');
    const target = this.scoped('users', userId, actor);
    check(!target.is_owner && userId !== actor.id, 'O administrador principal e seu próprio acesso não podem ser alterados aqui.');
    check(Array.isArray(data.permissions), 'Permissões inválidas.');
    const permissions = [...new Set(data.permissions)];
    check(permissions.every(p => PERMISSIONS.includes(p) && allowed(actor, p)), 'Permissões inválidas ou superiores às suas.');
    return this.transaction(() => {
      this.run('UPDATE users SET permissions=? WHERE tenant_id=? AND id=?', JSON.stringify(permissions), actor.tenant_id, userId);
      this.audit(actor, 'user', userId, 'permissions_updated', { before: JSON.parse(target.permissions), after: permissions });
      return { ok: true };
    });
  }
  addProduct(actor, data) {
    requirePermission(actor, 'products.manage');
    const name = text(data.name, 'Produto'), sku = text(data.sku, 'SKU', 80, false), price = integer(data.price_cents ?? 0, 'Preço');
    return this.transaction(() => {
      const productId = id();
      this.run('INSERT INTO products VALUES(?,?,?,?,?,?)', productId, actor.tenant_id, name, sku, price, now());
      this.audit(actor, 'product', productId, 'created');
      return { id: productId, name, sku, price_cents: price };
    });
  }
  addCustomer(actor, data) {
    requirePermission(actor, 'customers.manage');
    const name = text(data.name, 'Cliente'), email = text(data.email, 'E-mail', 254, false), phone = text(data.phone, 'Telefone', 40, false);
    const cpf = optionalCpf(data.cpf);
    return this.transaction(() => {
      const customerId = id();
      this.run('INSERT INTO customers(id,tenant_id,name,email,phone,created_at,cpf) VALUES(?,?,?,?,?,?,?)', customerId, actor.tenant_id, name, email, phone, now(), cpf);
      this.audit(actor, 'customer', customerId, 'created');
      return { id: customerId, name, email, phone, cpf };
    });
  }
  savePixAccount(actor, data, accountId = null) {
    requirePermission(actor, 'settings.manage');
    const existing = accountId ? this.scoped('pix_accounts', accountId, actor) : null;
    const name = text(data.name === undefined ? existing?.name : data.name, 'Nome da conta Pix', 80);
    const active = activeFlag(data.active, existing ? !!existing.active : true);
    const duplicate = this.get(`SELECT id FROM pix_accounts
      WHERE tenant_id=? AND name=? COLLATE NOCASE AND id<>?`, actor.tenant_id, name, accountId ?? '');
    check(!duplicate, 'Já existe uma conta Pix com esse nome.', 409);
    if (existing && existing.name === name && !!existing.active === active) {
      return { id: existing.id, name, active };
    }
    return this.transaction(() => {
      const key = accountId ?? id(), at = now();
      if (existing) {
        this.run('UPDATE pix_accounts SET name=?,active=?,updated_at=? WHERE tenant_id=? AND id=?',
          name, Number(active), at, actor.tenant_id, key);
        this.audit(actor, 'pix_account', key, 'updated', {
          before: { name: existing.name, active: !!existing.active }, after: { name, active }
        });
      } else {
        this.run(`INSERT INTO pix_accounts(id,tenant_id,name,active,created_at,updated_at)
          VALUES(?,?,?,?,?,?)`, key, actor.tenant_id, name, Number(active), at, at);
        this.audit(actor, 'pix_account', key, 'created', { name, active });
      }
      return { id: key, name, active };
    });
  }
  saveSupplier(actor, data, supplierId = null) {
    requirePermission(actor, 'stock.receive');
    const existing = supplierId ? this.scoped('suppliers', supplierId, actor) : null;
    const name = text(data.name === undefined ? existing?.name : data.name, 'Nome do fornecedor', 120);
    const email = optionalEmailAddress(data.email === undefined ? existing?.email ?? '' : data.email);
    const phone = text(data.phone === undefined ? existing?.phone ?? '' : data.phone, 'Telefone', 40, false);
    const duplicate = this.get(`SELECT id FROM suppliers
      WHERE tenant_id=? AND name=? COLLATE NOCASE AND id<>?`, actor.tenant_id, name, supplierId ?? '');
    check(!duplicate, 'Já existe um fornecedor com esse nome.', 409);
    if (existing && existing.name === name && existing.email === email && existing.phone === phone) {
      return { id: existing.id, name, email, phone };
    }
    return this.transaction(() => {
      const key = supplierId ?? id(), at = now();
      if (existing) {
        this.run('UPDATE suppliers SET name=?,email=?,phone=?,updated_at=? WHERE tenant_id=? AND id=?',
          name, email, phone, at, actor.tenant_id, key);
        this.audit(actor, 'supplier', key, 'updated', {
          before: { name: existing.name, email: existing.email, phone: existing.phone },
          after: { name, email, phone }
        });
      } else {
        this.run(`INSERT INTO suppliers(id,tenant_id,name,email,phone,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?)`, key, actor.tenant_id, name, email, phone, at, at);
        this.audit(actor, 'supplier', key, 'created', { name, email, phone });
      }
      return { id: key, name, email, phone };
    });
  }
  saveSaleStatus(actor, data, statusId = null) {
    requirePermission(actor, 'settings.manage');
    const existing = statusId ? this.scoped('sale_statuses', statusId, actor) : null;
    const name = text(data.name === undefined ? existing?.name : data.name, 'Nome do status', 60);
    const color = saleStatusColor(data.color, existing?.color ?? 'neutral');
    const duplicate = this.get(`SELECT id FROM sale_statuses
      WHERE tenant_id=? AND name=? COLLATE NOCASE AND id<>?`, actor.tenant_id, name, statusId ?? '');
    check(!duplicate, 'Já existe um status com esse nome.', 409);
    if (existing && existing.name === name && existing.color === color) return { id: existing.id, name, color };
    return this.transaction(() => {
      const key = statusId ?? id(), at = now();
      if (existing) {
        this.run('UPDATE sale_statuses SET name=?,color=?,updated_at=? WHERE tenant_id=? AND id=?',
          name, color, at, actor.tenant_id, key);
        this.audit(actor, 'sale_status', key, 'updated', {
          before: { name: existing.name, color: existing.color }, after: { name, color }
        });
      } else {
        this.run(`INSERT INTO sale_statuses(id,tenant_id,name,color,created_at,updated_at)
          VALUES(?,?,?,?,?,?)`, key, actor.tenant_id, name, color, at, at);
        this.audit(actor, 'sale_status', key, 'created', { name, color });
      }
      return { id: key, name, color };
    });
  }
  saveRate(actor, data, rateId = null) {
    requirePermission(actor, 'settings.manage');
    const machine = text(data.machine, 'Máquina', 80), brand = text(data.brand, 'Bandeira', 40);
    check(['credit', 'debit'].includes(data.mode), 'Modalidade inválida.');
    const installments = integer(data.installments, 'Parcelas', 1, 36), basis = integer(data.basis_points, 'Taxa', 0, 10_000);
    check(data.mode !== 'debit' || installments === 1, 'Débito deve ter uma parcela.');
    if (rateId) this.scoped('rates', rateId, actor);
    return this.transaction(() => {
      const group = this.ensureCardGroup(actor.tenant_id, machine, brand);
      const duplicate = this.get(`SELECT id FROM rates WHERE tenant_id=? AND brand_id=? AND mode=? AND installments=? AND active=1 AND id<>?`,
        actor.tenant_id, group.brand.id, data.mode, installments, rateId ?? '');
      check(!duplicate, 'Já existe uma taxa para essa máquina, bandeira e quantidade de parcelas.', 409);
      const archived = !rateId && this.get(`SELECT id FROM rates WHERE tenant_id=? AND brand_id=? AND mode=? AND installments=? AND active=0 ORDER BY created_at DESC,id LIMIT 1`,
        actor.tenant_id, group.brand.id, data.mode, installments);
      const key = rateId ?? archived?.id ?? id();
      this.run('UPDATE card_brands SET active=1,updated_at=? WHERE tenant_id=? AND id=?', now(), actor.tenant_id, group.brand.id);
      if (rateId || archived) this.run(`UPDATE rates SET machine=?,brand=?,machine_id=?,brand_id=?,mode=?,installments=?,basis_points=?,active=1 WHERE tenant_id=? AND id=?`,
        group.machine.name, group.brand.name, group.machine.id, group.brand.id, data.mode, installments, basis, actor.tenant_id, key);
      else this.run(`INSERT INTO rates(id,tenant_id,machine,brand,machine_id,brand_id,mode,installments,basis_points,active,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,1,?)`, key, actor.tenant_id, group.machine.name, group.brand.name, group.machine.id, group.brand.id, data.mode, installments, basis, now());
      this.audit(actor, 'rate', key, rateId ? 'updated' : 'created', { basis_points: basis });
      return { id: key };
    });
  }
  saveCardMachine(actor, data, machineId = null) {
    requirePermission(actor, 'settings.manage');
    const name = text(data.name, 'Nome da máquina', 80);
    check(Array.isArray(data.brands) && data.brands.length <= 50, 'Informe até 50 bandeiras.');
    const names = new Set(), ids = new Set();
    const brands = data.brands.map(item => {
      check(item && typeof item === 'object', 'Bandeira inválida.');
      const brandName = text(item.name, 'Bandeira', 40), normalizedName = brandName.toLowerCase();
      check(!names.has(normalizedName), 'Bandeiras com nomes repetidos não são permitidas.', 409);
      names.add(normalizedName);
      if (item.id !== undefined) {
        check(typeof item.id === 'string' && /^[a-f0-9-]{36}$/.test(item.id), 'Identificação da bandeira inválida.');
        check(!ids.has(item.id), 'Bandeira repetida.', 409); ids.add(item.id);
      }
      const debit = item.debit_basis_points == null ? null : integer(item.debit_basis_points, 'Taxa de débito', 0, 10_000);
      check(Array.isArray(item.credit_rates) && item.credit_rates.length <= 36, 'Informe até 36 taxas de crédito.');
      const installments = new Set();
      const credit = item.credit_rates.map(rate => {
        check(rate && typeof rate === 'object', 'Taxa de crédito inválida.');
        const count = integer(rate.installments, 'Parcelas', 1, 36), basis = integer(rate.basis_points, 'Taxa de crédito', 0, 10_000);
        check(!installments.has(count), 'Não repita a quantidade de parcelas da mesma bandeira.', 409);
        installments.add(count); return { mode: 'credit', installments: count, basis_points: basis };
      });
      return { id: item.id, name: brandName, rates: [...(debit === null ? [] : [{ mode: 'debit', installments: 1, basis_points: debit }]), ...credit] };
    });
    return this.transaction(() => {
      const existing = machineId ? this.scoped('card_machines', machineId, actor) : null;
      check(!this.get('SELECT id FROM card_machines WHERE tenant_id=? AND name=? COLLATE NOCASE AND id<>?',
        actor.tenant_id, name, machineId ?? ''), 'Já existe uma máquina com esse nome.', 409);
      const key = machineId ?? id(), at = now();
      const oldBrands = existing ? this.all('SELECT * FROM card_brands WHERE tenant_id=? AND machine_id=?', actor.tenant_id, key) : [];
      for (const brand of brands) {
        if (brand.id) {
          const found = this.scoped('card_brands', brand.id, actor);
          check(found.machine_id === key, 'Bandeira não pertence a essa máquina.', 404);
        } else brand.id = oldBrands.find(row => row.name.toLowerCase() === brand.name.toLowerCase())?.id ?? id();
      }
      check(new Set(brands.map(brand => brand.id)).size === brands.length, 'Bandeira repetida.', 409);
      for (const brand of brands) {
        check(!oldBrands.some(row => row.id !== brand.id && row.name.toLowerCase() === brand.name.toLowerCase()
          && !brands.some(candidate => candidate.id === row.id)), 'Já existe uma bandeira com esse nome nessa máquina.', 409);
      }
      const before = existing ? { name: existing.name, brands: oldBrands,
        rates: this.all('SELECT * FROM rates WHERE tenant_id=? AND machine_id=? AND active=1', actor.tenant_id, key) } : null;
      if (existing) this.run('UPDATE card_machines SET name=?,updated_at=? WHERE tenant_id=? AND id=?', name, at, actor.tenant_id, key);
      else this.run('INSERT INTO card_machines VALUES(?,?,?,?,?)', key, actor.tenant_id, name, at, at);
      const oldRates = this.all('SELECT * FROM rates WHERE tenant_id=? AND machine_id=? ORDER BY active DESC,created_at DESC,id', actor.tenant_id, key);
      // Temporary unique names permit swapping two brand names without changing their identities.
      for (const brand of brands.filter(brand => oldBrands.some(row => row.id === brand.id))) {
        this.run('UPDATE card_brands SET name=? WHERE tenant_id=? AND id=?', `__editing_${brand.id}`, actor.tenant_id, brand.id);
      }
      this.run('UPDATE card_brands SET active=0,updated_at=? WHERE tenant_id=? AND machine_id=?', at, actor.tenant_id, key);
      this.run('UPDATE rates SET active=0,machine=? WHERE tenant_id=? AND machine_id=?', name, actor.tenant_id, key);
      for (const brand of brands) {
        if (oldBrands.some(row => row.id === brand.id)) {
          this.run('UPDATE card_brands SET name=?,active=1,updated_at=? WHERE tenant_id=? AND id=?', brand.name, at, actor.tenant_id, brand.id);
        } else this.run('INSERT INTO card_brands VALUES(?,?,?,?,1,?,?)', brand.id, actor.tenant_id, key, brand.name, at, at);
        this.run('UPDATE rates SET brand=? WHERE tenant_id=? AND brand_id=?', brand.name, actor.tenant_id, brand.id);
        for (const rate of brand.rates) {
          const matches = oldRates.filter(row => row.brand_id === brand.id && row.mode === rate.mode && row.installments === rate.installments);
          check(matches.filter(row => row.active).length <= 1, 'Existem taxas duplicadas para essa bandeira e parcela; revise o cadastro antes de salvar.', 409);
          const retained = matches[0];
          if (retained) this.run('UPDATE rates SET basis_points=?,active=1 WHERE tenant_id=? AND id=?', rate.basis_points, actor.tenant_id, retained.id);
          else this.run(`INSERT INTO rates(id,tenant_id,machine,brand,machine_id,brand_id,mode,installments,basis_points,active,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,1,?)`, id(), actor.tenant_id, name, brand.name, key, brand.id, rate.mode, rate.installments, rate.basis_points, at);
        }
      }
      this.audit(actor, 'card_machine', key, existing ? 'updated' : 'created', { before, after: { name, brands } });
      return { id: key };
    });
  }
  receive(actor, data) {
    requirePermission(actor, 'stock.receive'); requirePermission(actor, 'costs.enter');
    this.scoped('products', data.product_id, actor);
    const rawSupplierId = data.supplier_id;
    check(rawSupplierId === undefined || rawSupplierId === null || rawSupplierId === '' ||
      (typeof rawSupplierId === 'string' && rawSupplierId.trim()), 'Fornecedor inválido.');
    const supplierId = rawSupplierId ? rawSupplierId.trim().toLowerCase() : null;
    const supplier = supplierId ? this.scoped('suppliers', supplierId, actor) : null;
    const quantity = integer(data.quantity, 'Quantidade', 1, 1_000_000), cost = integer(data.unit_cost_cents, 'Custo');
    return this.transaction(() => {
      const lotId = id(); let remaining = quantity;
      this.run(`INSERT INTO lots(id,tenant_id,product_id,quantity_initial,quantity_remaining,unit_cost_cents,received_at,supplier_id,supplier_name)
        VALUES(?,?,?,?,?,?,?,?,?)`, lotId, actor.tenant_id, data.product_id, quantity, quantity, cost, now(),
        supplier?.id ?? null, supplier?.name ?? null);
      // A entrada cobre primeiro as saídas sem custo, pela ordem da confirmação.
      const pending = this.all(`SELECT a.* FROM allocations a JOIN sale_items i ON i.id=a.item_id AND i.tenant_id=a.tenant_id
        JOIN sales s ON s.id=i.sale_id AND s.tenant_id=i.tenant_id
        LEFT JOIN sale_fifo_order so ON so.tenant_id=s.tenant_id AND so.sale_id=s.id
        WHERE a.tenant_id=? AND i.product_id=? AND a.lot_id IS NULL AND s.status='confirmed'
        ORDER BY COALESCE(so.sequence,s.rowid), i.ordinal, a.rowid`, actor.tenant_id, data.product_id);
      for (const allocation of pending) {
        if (!remaining) break;
        const used = Math.min(remaining, allocation.quantity);
        if (used === allocation.quantity) this.run('UPDATE allocations SET lot_id=?,unit_cost_cents=? WHERE tenant_id=? AND id=?',
          lotId, cost, actor.tenant_id, allocation.id);
        else {
          this.run('UPDATE allocations SET quantity=quantity-? WHERE tenant_id=? AND id=?', used, actor.tenant_id, allocation.id);
          this.run('INSERT INTO allocations VALUES(?,?,?,?,?,?)', id(), actor.tenant_id, allocation.item_id, lotId, used, cost);
        }
        remaining -= used;
        this.audit(actor, 'sale_item', allocation.item_id, 'pending_cost_resolved', { lot_id: lotId, quantity: used, unit_cost_cents: cost });
      }
      this.run('UPDATE lots SET quantity_remaining=? WHERE tenant_id=? AND id=?', remaining, actor.tenant_id, lotId);
      this.audit(actor, 'lot', lotId, 'received', { quantity, unit_cost_cents: cost,
        supplier_id: supplier?.id ?? null, supplier_name: supplier?.name ?? null,
        consumed_by_pending: quantity - remaining });
      return { id: lotId, quantity_remaining: remaining, resolved_quantity: quantity - remaining,
        supplier_id: supplier?.id ?? null, supplier_name: supplier?.name ?? null };
    });
  }
  saveDraft(actor, data, saleId = null) {
    requirePermission(actor, saleId ? 'sales.edit_draft' : 'sales.create');
    const existingSale = saleId ? this.saleAccess(actor, saleId) : null;
    if (existingSale) check(existingSale.status === 'draft', 'Venda confirmada ou cancelada não pode ser alterada pelo formulário de rascunho.', 409);
    const saleDate = data.business_date === undefined
      ? (existingSale ? existingSale.business_date : businessDate())
      : validDate(data.business_date);
    if (saleDate) this.validateSaleDate(actor, saleDate);
    const existingItems = existingSale ? this.saleItems(actor, saleId) : [];
    const wholesale = data.is_wholesale === undefined ? !!existingSale?.is_wholesale : data.is_wholesale;
    check(typeof wholesale === 'boolean', 'Marcação de venda de atacado inválida.');
    if (existingSale && data.is_wholesale !== undefined && data.original_is_wholesale !== undefined) {
      check(typeof data.original_is_wholesale === 'boolean', 'Marcação original de atacado inválida.');
      check(data.original_is_wholesale === !!existingSale.is_wholesale,
        'A marcação de atacado mudou em outra tela. Atualize a venda antes de salvar.', 409);
    }
    const customerId = data.customer_id || null, sellerId = data.seller_id || null;
    if (customerId) this.scoped('customers', customerId, actor);
    if (sellerId) {
      check(this.scoped('users', sellerId, actor).active || sellerId === existingSale?.seller_id, 'Vendedor inativo.');
      if (sellerId !== actor.id && sellerId !== existingSale?.seller_id) requirePermission(actor, 'sales.assign_seller');
    }
    const freight = integer(data.freight_cents ?? existingSale?.freight_cents ?? 0, 'Frete');
    const expenses = data.expenses ?? (existingSale ? JSON.parse(existingSale.expenses_json) : []);
    check(Array.isArray(expenses) && expenses.length <= 50, 'Despesas inválidas.');
    const cleanExpenses = expenses.map(e => ({ description: text(e.description, 'Descrição da despesa'), amount_cents: integer(e.amount_cents, 'Despesa') }));
    if ((data.freight_cents !== undefined && freight !== (existingSale?.freight_cents ?? 0)) ||
      (data.expenses !== undefined && JSON.stringify(cleanExpenses) !== (existingSale?.expenses_json ?? '[]'))) requirePermission(actor, 'costs.enter');
    const notes = text(data.public_notes, 'Observação para cliente', 2000, false);
    check(Array.isArray(data.items) && data.items.length <= 100, 'Itens inválidos.');
    const items = data.items.map((item, ordinal) => {
      check(item && typeof item === 'object' && !Array.isArray(item),'Item inválido.');
      for(const key of ['serial_number','details']) check(item[key] == null || typeof item[key] === 'string','IMEI / SN e detalhes devem ser texto.');
      let name = text(item.description, 'Descrição', 200, false), productId = item.product_id || null;
      if (productId) {
        const product=this.scoped('products',productId,actor),original=existingItems.find(i=>i.id===item.id&&i.product_id===productId);
        name = name || (item.description===undefined?original?.description:null) || product.name;
      }
      check(name, 'Informe o nome do produto avulso.');
      const originalItem = item.id ? existingItems.find(i => i.id === item.id) : null;
      const originalDetails = originalItem?.product_id === productId ? originalItem : null;
      check(!item.id || !!originalItem, 'Item não encontrado nesta venda.', 404);
      if (!productId && Object.hasOwn(item, 'manual_cost_cents')) requirePermission(actor, 'costs.enter');
      let manualCost = !productId && item.manual_cost_cents === undefined ? originalItem?.manual_cost_cents ?? null : null;
      if (!productId && item.manual_cost_cents !== null && item.manual_cost_cents !== undefined) {
        requirePermission(actor, 'costs.enter'); manualCost = integer(item.manual_cost_cents, 'Custo manual');
      }
      return { id: originalItem?.id ?? id(), product_id: productId, description: name,
        quantity: integer(item.quantity, 'Quantidade', 1, 1_000_000), unit_price_cents: integer(item.unit_price_cents, 'Preço'),
        manual_cost_cents: manualCost, ordinal,
        serial_number: text(item.serial_number === undefined ? originalDetails?.serial_number : item.serial_number, 'IMEI / SN', 1000, false),
        details: text(item.details === undefined ? originalDetails?.details : item.details, 'Detalhes do produto', 2000, false),
        share_details: item.share_details === undefined ? !!originalDetails?.share_details : item.share_details };
    });
    check(items.every(i => typeof i.share_details === 'boolean'), 'Escolha de exibição dos detalhes inválida.');
    check(new Set(items.map(i => i.id)).size === items.length, 'Não repita o mesmo item na venda.');

    saleTotal(items); sumMoney([freight, ...cleanExpenses.map(e => e.amount_cents)]);
    return this.transaction(() => {
      const key = saleId ?? id(), at = now();
      if (saleId) {
        check(this.saleAccess(actor,saleId).status==='draft','Esta venda não é mais um rascunho. Atualize a tela.',409);
        this.run(`UPDATE sales SET customer_id=?,seller_id=?,freight_cents=?,expenses_json=?,public_notes=?,updated_at=?,is_wholesale=?,business_date=?
          WHERE tenant_id=? AND id=?`, customerId, sellerId, freight, JSON.stringify(cleanExpenses), notes, at, Number(wholesale), saleDate, actor.tenant_id, key);
        this.run('DELETE FROM sale_items WHERE tenant_id=? AND sale_id=?', actor.tenant_id, key);
      } else {
        const number = this.get('SELECT COALESCE(MAX(number),0)+1 AS number FROM sales WHERE tenant_id=?', actor.tenant_id).number;
        this.run(`INSERT INTO sales(id,tenant_id,number,customer_id,seller_id,created_by,freight_cents,expenses_json,public_notes,created_at,updated_at,is_wholesale,business_date)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, key, actor.tenant_id, number, customerId, sellerId, actor.id, freight, JSON.stringify(cleanExpenses), notes, at, at, Number(wholesale), saleDate);
      }
      for (const item of items) this.run('INSERT INTO sale_items VALUES(?,?,?,?,?,?,?,?,?)', item.id, actor.tenant_id, key,
        item.product_id, item.description, item.quantity, item.unit_price_cents, item.manual_cost_cents, item.ordinal);
      for (const item of items) if(item.serial_number || item.details || item.share_details) this.run('INSERT INTO sale_item_details VALUES(?,?,?,?,?)', actor.tenant_id,item.id,item.serial_number,item.details,Number(item.share_details));
      this.audit(actor, 'sale', key, saleId ? 'draft_updated' : 'draft_created', {
        business_date_before: existingSale?.business_date ?? null, business_date: saleDate
      });
      return { id: key };
    });
  }
  addPayment(actor, saleId, data) {
    requirePermission(actor, 'payments.record'); this.saleAccess(actor, saleId);
    const requestId = typeof data.request_id === 'string' ? data.request_id.trim().toLowerCase() : '';
    check(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId), 'request_id deve ser um UUID válido.');
    check(['pix', 'cash', 'card'].includes(data.method), 'Forma de pagamento inválida.');
    const amount = integer(data.amount_cents, 'Pagamento', 1);
    const optionalId = (value, label) => {
      if (value === undefined || value === null || value === '') return null;
      check(typeof value === 'string' && value.trim(), `${label} inválido.`);
      return value.trim().toLowerCase();
    };
    const rateId = optionalId(data.rate_id, 'Identificador da taxa');
    const pixAccountId = optionalId(data.pix_account_id, 'Identificador da conta Pix');
    if (data.method === 'card') {
      check(rateId, 'Selecione a taxa do cartão.');
      check(!pixAccountId, 'Conta Pix não pode ser informada em pagamento por cartão.');
    } else {
      check(!rateId, 'Taxa só pode ser informada em pagamento por cartão.');
      if (data.method === 'cash') check(!pixAccountId, 'Conta Pix só pode ser informada em pagamento por Pix.');
    }
    return this.transaction(() => {
      const previous = this.get('SELECT sale_id,payment_id,payload_hash FROM payment_requests WHERE tenant_id=? AND request_id=?',
        actor.tenant_id, requestId);
      if (previous) {
        const previousPayment = this.get(`SELECT method,amount_cents,pix_account_id,pix_account_name
          FROM payments WHERE tenant_id=? AND id=?`, actor.tenant_id, previous.payment_id);
        check(previousPayment, 'request_id já foi usado com outro pagamento.', 409);
        const payloadHash = paymentPayloadHash({ saleId, method: data.method, amount, rateId,
          pixAccountId, pixAccountName: previousPayment.pix_account_name ?? null });
        const legacyHash = legacyPaymentPayloadHash({ saleId, method: data.method, amount, rateId });
        check(previous.sale_id === saleId && (previous.payload_hash === payloadHash ||
          (previousPayment.pix_account_id === null && pixAccountId === null && previous.payload_hash === legacyHash)),
          'request_id já foi usado com outro pagamento.', 409);
        return { id: previous.payment_id, replayed: true };
      }
      check(this.saleAccess(actor, saleId).status!=='cancelled','Venda cancelada não pode receber pagamentos.',409);
      let rate = null;
      if (data.method === 'card') { rate = this.scoped('rates', rateId, actor); check(rate.active, 'Taxa inativa.'); }
      let pixAccount = null;
      if (data.method === 'pix') {
        check(pixAccountId, 'Selecione a conta Pix.');
        pixAccount = this.scoped('pix_accounts', pixAccountId, actor);
        check(pixAccount.active, 'Conta Pix inativa.');
      }
      const payloadHash = paymentPayloadHash({ saleId, method: data.method, amount, rateId,
        pixAccountId: pixAccount?.id ?? null, pixAccountName: pixAccount?.name ?? null });
      const existing = this.effectivePayments(actor,saleId);
      sumMoney([amount, ...existing.map(p => p.amount_cents)]);
      const paymentId = id(), basis = rate?.basis_points ?? 0;
      this.run(`INSERT INTO payments(id,tenant_id,sale_id,method,amount_cents,machine,brand,mode,installments,basis_points,fee_cents,created_at,pix_account_id,pix_account_name)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, paymentId, actor.tenant_id, saleId, data.method,
        amount, rate?.machine ?? null, rate?.brand ?? null, rate?.mode ?? null, rate?.installments ?? null,
        basis, feeCents(amount, basis), now(), pixAccount?.id ?? null, pixAccount?.name ?? null);
      this.run('INSERT INTO payment_requests VALUES(?,?,?,?,?,?)', actor.tenant_id, requestId, saleId, paymentId, payloadHash, now());
      this.audit(actor, 'payment', paymentId, 'recorded', { sale_id: saleId, amount_cents: amount,
        pix_account_id: pixAccount?.id ?? null, pix_account_name: pixAccount?.name ?? null, request_id: requestId });
      return { id: paymentId, replayed: false };
    });
  }
  validateSaleDate(actor, value) {
    const day = validDate(value);
    check(day <= businessDate(), 'A data da venda não pode estar no futuro.');
    check(!this.get('SELECT id FROM finance_closures WHERE tenant_id=? AND reference_month=?', actor.tenant_id, day.slice(0,7)),
      'O mês desta data já foi fechado. Escolha uma data de mês aberto.', 409);
    return day;
  }
  confirm(actor, saleId, acknowledgeDifference = false) {
    requirePermission(actor, 'sales.confirm');
    return this.transaction(() => {
      const sale = this.saleAccess(actor, saleId);
      check(sale.status!=='cancelled','Venda cancelada não pode ser confirmada novamente.',409);
      if (sale.status === 'confirmed') return { id: saleId, already_confirmed: true };
      const saleDate = this.validateSaleDate(actor, sale.business_date ?? businessDate());
      check(sale.customer_id && sale.seller_id, 'Escolha o cliente e o vendedor antes de confirmar.');
      const items = this.all('SELECT * FROM sale_items WHERE tenant_id=? AND sale_id=? ORDER BY ordinal', actor.tenant_id, saleId);
      check(items.length, 'Adicione pelo menos um produto.');
      const payments = this.effectivePayments(actor,saleId);
      const reconciliation = reconcile(saleTotal(items), payments);
      check(reconciliation.state === 'matched' || acknowledgeDifference === true,
        'Há diferença entre pagamentos e venda. Confirme que deseja continuar.', 409);
      for (const item of items) {
        if (!item.product_id) continue;
        const lots = this.all(`SELECT * FROM lots WHERE tenant_id=? AND product_id=? AND quantity_remaining>0
          ORDER BY received_at, rowid`, actor.tenant_id, item.product_id);
        const plan = planFIFO(lots, item.quantity);
        for (const allocation of plan.allocations) {
          if (allocation.lot_id) this.run(`UPDATE lots SET quantity_remaining=quantity_remaining-?
            WHERE tenant_id=? AND id=?`, allocation.quantity, actor.tenant_id, allocation.lot_id);
          this.run('INSERT INTO allocations VALUES(?,?,?,?,?,?)', id(), actor.tenant_id, item.id,
            allocation.lot_id, allocation.quantity, allocation.unit_cost_cents);
        }
      }
      this.run(`UPDATE sales SET status='confirmed',confirmed_at=?,business_date=?,updated_at=? WHERE tenant_id=? AND id=?`,
        now(), saleDate, now(), actor.tenant_id, saleId);
      this.audit(actor, 'sale', saleId, 'confirmed', { difference_cents: reconciliation.difference_cents, business_date: saleDate });
      this.operations.recordOrder(actor,saleId);
      return { id: saleId };
    });
  }
  setOperationalStatus(actor, saleId, data) {
    requirePermission(actor, 'sales.change_status');
    check(this.saleAccess(actor, saleId).status!=='cancelled','O status de uma venda cancelada não pode ser alterado.',409);
    check(Object.hasOwn(data, 'operational_status_id'), 'Informe operational_status_id.');
    const rawStatusId = data.operational_status_id;
    check(rawStatusId === null || (typeof rawStatusId === 'string' && rawStatusId.trim()),
      'Status da venda inválido.');
    const statusId = rawStatusId === null ? null : rawStatusId.trim().toLowerCase();
    if (statusId) this.scoped('sale_statuses', statusId, actor);
    this.transaction(() => {
      check(this.saleAccess(actor,saleId).status!=='cancelled','O status de uma venda cancelada não pode ser alterado.',409);
      const previous = this.get(`SELECT status_id FROM sale_status_assignments
        WHERE tenant_id=? AND sale_id=?`, actor.tenant_id, saleId);
      const before = previous?.status_id ?? null;
      if (before === statusId) return;
      if (statusId === null) {
        this.run('DELETE FROM sale_status_assignments WHERE tenant_id=? AND sale_id=?', actor.tenant_id, saleId);
      } else {
        this.run(`INSERT INTO sale_status_assignments(tenant_id,sale_id,status_id,assigned_by,assigned_at)
          VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,sale_id) DO UPDATE SET
          status_id=excluded.status_id,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at`,
          actor.tenant_id, saleId, statusId, actor.id, now());
      }
      this.audit(actor, 'sale', saleId, 'operational_status_changed', {
        operational_status_id_before: before, operational_status_id_after: statusId
      });
    });
    return this.sale(actor, saleId);
  }
  saleItems(actor, saleId) {
    return this.all(`SELECT i.*,COALESCE(d.serial_number,'') AS serial_number,COALESCE(d.details,'') AS details,
      COALESCE(d.share_details,0) AS share_details FROM sale_items i LEFT JOIN sale_item_details d
      ON d.tenant_id=i.tenant_id AND d.item_id=i.id WHERE i.tenant_id=? AND i.sale_id=? ORDER BY i.ordinal`,actor.tenant_id,saleId)
      .map(i=>({...i,share_details:!!i.share_details}));
  }
  effectivePayments(actor,saleId) {
    return this.all(`SELECT p.* FROM payments p WHERE p.tenant_id=? AND p.sale_id=?
      AND NOT EXISTS(SELECT 1 FROM payment_changes c WHERE c.tenant_id=p.tenant_id AND c.payment_id=p.id)
      ORDER BY p.created_at,p.rowid`,actor.tenant_id,saleId);
  }
  fullSale(actor, saleId) {
    const row = this.saleAccess(actor, saleId);
    if(row.status==='cancelled')return cancelledSale(row,this.get(`SELECT c.*,u.name AS author FROM sale_cancellations c
      JOIN users u ON u.tenant_id=c.tenant_id AND u.id=c.actor_id WHERE c.tenant_id=? AND c.sale_id=?`,actor.tenant_id,saleId));
    const items = this.saleItems(actor, saleId);
    const payments = this.effectivePayments(actor,saleId);
    const operationalStatusRow = this.get(`SELECT ss.id,ss.name,ss.color FROM sale_status_assignments a
      JOIN sale_statuses ss ON ss.tenant_id=a.tenant_id AND ss.id=a.status_id
      WHERE a.tenant_id=? AND a.sale_id=?`, actor.tenant_id, saleId);
    const operationalStatus = operationalStatusRow ? { ...operationalStatusRow } : null;
    let knownCost = 0, pendingQuantity = 0;
    for (const item of items) {
      if (!item.product_id) {
        item.cost_cents = item.manual_cost_cents === null ? null : item.quantity * item.manual_cost_cents;
        item.pending_cost_quantity = item.manual_cost_cents === null ? item.quantity : 0;
      } else if (row.status === 'draft') {
        item.cost_cents = null; item.pending_cost_quantity = item.quantity;
      } else {
        item.allocations = this.all('SELECT lot_id,quantity,unit_cost_cents FROM allocations WHERE tenant_id=? AND item_id=?', actor.tenant_id, item.id);
        item.cost_cents = sumMoney(item.allocations.filter(a => a.unit_cost_cents !== null).map(a => a.quantity * a.unit_cost_cents));
        item.pending_cost_quantity = item.allocations.filter(a => a.unit_cost_cents === null).reduce((s, a) => s + a.quantity, 0);
      }
      knownCost += item.cost_cents ?? 0; pendingQuantity += item.pending_cost_quantity;
    }
    const expenses = JSON.parse(row.expenses_json), total = saleTotal(items), reconciliation = reconcile(total, payments);
    const provisionalProfit = pendingQuantity || row.status === 'draft' ? null : total - reconciliation.fee_cents - knownCost - row.freight_cents - sumMoney(expenses.map(e => e.amount_cents));
    return { ...row, is_wholesale: !!row.is_wholesale, items:itemFinancials(items,reconciliation,row.freight_cents,sumMoney(expenses.map(e=>e.amount_cents)),provisionalProfit), payments, expenses, total_cents: total, reconciliation,
      operational_status_id: operationalStatus?.id ?? null, operational_status: operationalStatus,
      store_name: this.get('SELECT name FROM tenants WHERE id=?', actor.tenant_id).name,
      customer_name: row.customer_id ? this.scoped('customers', row.customer_id, actor).name : null,
      seller_name: row.seller_id ? this.scoped('users', row.seller_id, actor).name : null,
      known_cost_cents: knownCost, pending_cost_quantity: pendingQuantity,
      provisional_profit_cents: provisionalProfit,
      profit_cents: reconciliation.state === 'matched' ? provisionalProfit : null,
      profit_state: row.status === 'draft' ? 'draft' : pendingQuantity ? 'pending_cost' : reconciliation.state !== 'matched' ? 'pending_reconciliation' : 'complete' };
  }
  sale(actor, saleId) {
    const sale = this.fullSale(actor, saleId);
    sale.edit_token=this.operations.editToken(sale);
    sale.corrections=this.all("SELECT a.created_at,u.name AS author,json_extract(a.data_json,'$.reason') AS reason FROM audit a JOIN users u ON u.id=a.actor_id AND u.tenant_id=a.tenant_id WHERE a.tenant_id=? AND a.entity='sale' AND a.entity_id=? AND a.action='confirmed_corrected' ORDER BY a.created_at DESC,a.rowid DESC",actor.tenant_id,saleId);
    delete sale.share_hash; delete sale.share_expires; delete sale.expenses_json;
    if (!allowed(actor, 'costs.view')) {
      delete sale.known_cost_cents; delete sale.freight_cents; delete sale.expenses;
      delete sale.reconciliation.fee_cents; delete sale.reconciliation.net_cents;
      sale.items = sale.items.map(({ manual_cost_cents, cost_cents, allocations, fee_share_cents, freight_share_cents, expense_share_cents, ...item }) => item);
      sale.payments = sale.payments.map(({ basis_points, fee_cents, ...payment }) => payment);
    }
    if (!allowed(actor, 'profit.view')) { delete sale.profit_cents; delete sale.provisional_profit_cents; sale.items=sale.items.map(({profit_cents,provisional_profit_cents,...item})=>item); }
    return sale;
  }
  products(actor) {
    const costs = allowed(actor, 'costs.view') ? `,
      (SELECT l.unit_cost_cents FROM lots l
        WHERE l.tenant_id=p.tenant_id AND l.product_id=p.id AND l.quantity_remaining>0
        ORDER BY l.received_at,l.rowid LIMIT 1) AS fifo_cost_cents,
      (SELECT l.unit_cost_cents FROM lots l
        WHERE l.tenant_id=p.tenant_id AND l.product_id=p.id
        AND NOT EXISTS(SELECT 1 FROM stock_entry_state es WHERE es.tenant_id=l.tenant_id AND es.lot_id=l.id AND es.voided_at IS NOT NULL)
        ORDER BY l.received_at DESC,l.rowid DESC LIMIT 1) AS last_cost_cents` : '';
    return this.all(`SELECT p.*, COALESCE((SELECT SUM(l.quantity_remaining) FROM lots l WHERE l.tenant_id=p.tenant_id AND l.product_id=p.id),0)
      - COALESCE((SELECT SUM(a.quantity) FROM allocations a JOIN sale_items i ON i.id=a.item_id AND i.tenant_id=a.tenant_id
      JOIN sales s ON s.tenant_id=i.tenant_id AND s.id=i.sale_id
      WHERE a.tenant_id=p.tenant_id AND i.product_id=p.id AND a.lot_id IS NULL AND s.status='confirmed'),0) AS stock
      ${costs} FROM products p WHERE p.tenant_id=? ORDER BY p.name`, actor.tenant_id);
  }
  productHistory(actor, productId) {
    this.scoped('products', productId, actor);
    const product = this.products(actor).find(item => item.id === productId);
    const entries = this.operations.entries(actor).filter(e=>e.product_id===productId);
    let saleScope = '', params = [actor.tenant_id, productId];
    if (!allowed(actor, 'sales.view_all')) {
      saleScope = ' AND (s.seller_id=? OR s.created_by=?)'; params.push(actor.id, actor.id);
    }
    const sales = this.all(`SELECT s.id AS sale_id,i.id AS sale_item_id,s.number,s.status,s.business_date,
      s.created_at,s.confirmed_at,c.name AS customer_name,u.name AS seller_name,
      i.quantity,i.unit_price_cents,i.quantity*i.unit_price_cents AS total_cents
      FROM sale_items i JOIN sales s ON s.tenant_id=i.tenant_id AND s.id=i.sale_id
      LEFT JOIN customers c ON c.tenant_id=s.tenant_id AND c.id=s.customer_id
      LEFT JOIN users u ON u.tenant_id=s.tenant_id AND u.id=s.seller_id
      WHERE i.tenant_id=? AND i.product_id=? AND s.status='confirmed'${saleScope}
      ORDER BY s.confirmed_at DESC,s.rowid DESC,i.ordinal`, ...params);
    return { product, entries, sales };
  }
  listSales(actor, filters = {}) {
    let where = 'tenant_id=?', params = [actor.tenant_id];
    if (!allowed(actor, 'sales.view_all')) { where += ' AND (seller_id=? OR created_by=?)'; params.push(actor.id, actor.id); }
    for (const [name, operator] of [['from', '>='], ['to', '<=']]) {
      if (filters[name]) {
        check(/^\d{4}-\d{2}-\d{2}$/.test(filters[name]), 'Data inválida.');
        where += ` AND COALESCE(business_date,date(created_at,'-3 hours'))${operator}?`; params.push(filters[name]);
      }
    }
    if (filters.status) { check(['draft', 'confirmed', 'cancelled'].includes(filters.status), 'Situação inválida.'); where += ' AND status=?'; params.push(filters.status); }
    if (filters.operational_status_id) {
      const statusId = String(filters.operational_status_id).trim().toLowerCase();
      this.scoped('sale_statuses', statusId, actor);
      where += ` AND EXISTS (SELECT 1 FROM sale_status_assignments a
        WHERE a.tenant_id=sales.tenant_id AND a.sale_id=sales.id AND a.status_id=?)`;
      params.push(statusId);
    }
    if (filters.seller_id) { this.scoped('users', filters.seller_id, actor); where += ' AND seller_id=?'; params.push(filters.seller_id); }
    return this.all(`SELECT id FROM sales WHERE ${where} ORDER BY created_at DESC,rowid DESC`, ...params).map(s => this.sale(actor, s.id));
  }
  snapshot(actor, filters = {}) {
    const sales = this.listSales(actor, filters), confirmed = sales.filter(s => s.status === 'confirmed');
    const rates = this.all('SELECT id,machine,brand,machine_id,brand_id,mode,installments,basis_points FROM rates WHERE tenant_id=? AND active=1 ORDER BY machine,brand,installments', actor.tenant_id)
      .map(rate => { if (!(allowed(actor, 'costs.view') || allowed(actor, 'settings.manage'))) delete rate.basis_points; return rate; });
    const users = this.all('SELECT id,name,email,is_owner,permissions FROM users WHERE tenant_id=? AND active=1 ORDER BY name', actor.tenant_id)
      .map(user => { const result = { id: user.id, name: user.name, is_owner: !!user.is_owner };
        if (allowed(actor, 'users.manage')) Object.assign(result, { email: user.email, permissions: JSON.parse(user.permissions) }); return result; });
    const dashboard = { sales_count: confirmed.length,
      revenue_cents: confirmed.reduce((sum, s) => sum + s.total_cents, 0),
      gross_cents: confirmed.reduce((sum, s) => sum + s.reconciliation.gross_cents, 0),
      pending_cents: confirmed.reduce((sum, s) => sum + s.reconciliation.pending_cents, 0),
      excess_cents: confirmed.reduce((sum, s) => sum + s.reconciliation.excess_cents, 0),
      incomplete_sales: confirmed.filter(s => s.profit_state !== 'complete').length };
    if (allowed(actor, 'profit.view')) dashboard.profit_cents = confirmed.reduce((sum, s) => sum + (s.profit_cents ?? 0), 0);
    if (allowed(actor, 'costs.view')) dashboard.fees_cents = confirmed.reduce((sum, s) => sum + s.reconciliation.fee_cents, 0);
    return { user: safeUser(actor), store: this.get('SELECT id,name FROM tenants WHERE id=?', actor.tenant_id),
      permissions: PERMISSIONS, users, customers: this.all('SELECT id,name,email,phone,cpf FROM customers WHERE tenant_id=? ORDER BY name', actor.tenant_id),
      products: this.products(actor), rates,
      card_machines: this.all('SELECT id,name FROM card_machines WHERE tenant_id=? ORDER BY name', actor.tenant_id)
        .map(machine => ({ ...machine, brands: this.all('SELECT id,name FROM card_brands WHERE tenant_id=? AND machine_id=? AND active=1 ORDER BY name', actor.tenant_id, machine.id) })),
      pix_accounts: this.all('SELECT id,name,active FROM pix_accounts WHERE tenant_id=? ORDER BY name', actor.tenant_id)
        .map(account => ({ ...account, active: !!account.active })),
      suppliers: this.all('SELECT id,name,email,phone FROM suppliers WHERE tenant_id=? ORDER BY name', actor.tenant_id),
      sale_statuses: this.all('SELECT id,name,color FROM sale_statuses WHERE tenant_id=? ORDER BY name', actor.tenant_id),
      sales, dashboard,refunds_pending:pendingRefunds(this,actor),stock_entries:this.operations.entries(actor),
      ...(allowed(actor,'expenses.view') ? { expense_reminders:this.finance.reminders(actor) } : {}) };
  }
  share(actor, saleId) {
    requirePermission(actor, 'sales.share'); check(this.saleAccess(actor, saleId).status!=='cancelled','Venda cancelada não pode gerar pedido para o cliente.',409);
    const token = randomBytes(32).toString('hex');
    this.transaction(() => {
      check(this.saleAccess(actor,saleId).status!=='cancelled','Venda cancelada não pode gerar pedido para o cliente.',409);
      this.run('UPDATE sales SET share_hash=?,share_expires=? WHERE tenant_id=? AND id=?', hash(token), Date.now() + 7 * 86400_000, actor.tenant_id, saleId);
      this.audit(actor, 'sale', saleId, 'share_link_rotated');
    });
    return { token };
  }
  public(token) {
    check(/^[a-f0-9]{64}$/.test(token), 'Link inválido ou expirado.', 404);
    const sale = this.get("SELECT id,created_by FROM sales WHERE status<>'cancelled' AND share_hash=? AND share_expires>?", hash(token), Date.now());
    check(sale, 'Link inválido ou expirado.', 404);
    const actor = parseUser(this.get('SELECT * FROM users WHERE id=?', sale.created_by));
    return publicSale(this.fullSale(actor, sale.id));
  }
}
