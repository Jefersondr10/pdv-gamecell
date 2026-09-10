import { randomBytes, randomUUID } from 'node:crypto';
import { check, text } from './domain.mjs';

export function migrateGoogleUsers(store) {
  if (!store.all('PRAGMA table_info(users)').some(row => row.name === 'auth_kind')) {
    store.db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON;');
    try {
      store.transaction(() => {
        store.db.exec(`CREATE TABLE users_google_upgrade (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
          name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE,
          salt TEXT NOT NULL, password_hash TEXT NOT NULL, permissions TEXT NOT NULL DEFAULT '[]',
          is_owner INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL, auth_kind TEXT NOT NULL DEFAULT 'password' CHECK(auth_kind IN ('password','google')),
          UNIQUE(tenant_id,id));
          INSERT INTO users_google_upgrade(id,tenant_id,name,email,salt,password_hash,permissions,is_owner,active,created_at)
            SELECT id,tenant_id,name,email,salt,password_hash,permissions,is_owner,active,created_at FROM users;
          DROP TABLE users;
          ALTER TABLE users_google_upgrade RENAME TO users;`);
        check(store.all('PRAGMA foreign_key_check').length === 0, 'Falha de integridade na migração de usuários.');
      });
    } finally { store.db.exec('PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON;'); }
  }
  store.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_password_email ON users(email COLLATE NOCASE) WHERE auth_kind='password';
    CREATE TABLE IF NOT EXISTS google_identities (
      subject TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id));`);
}

export function googleLogin(store, identity, storeName) {
  check(identity && typeof identity.sub === 'string' && /^[a-zA-Z0-9_-]{1,255}$/.test(identity.sub), 'Identidade inválida.');
  const email = text(identity.email, 'E-mail', 254).toLowerCase();
  check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'E-mail Google inválido.');
  const name = text(identity.name, 'Nome', 120);
  return store.transaction(() => {
    let user = store.get(`SELECT u.* FROM users u JOIN google_identities g ON g.user_id=u.id AND g.tenant_id=u.tenant_id WHERE g.subject=?`, identity.sub);
    if (user) {
      check(user.active && user.is_owner && user.auth_kind === 'google', 'Este acesso está desativado. Procure o responsável pelo sistema.', 403);
      store.run('UPDATE users SET email=?,name=? WHERE id=?', email, name, user.id);
      user = { ...user, email, name };
    } else {
      if (storeName === undefined) return { needs_store: true, name, email };
      const tenantName = text(storeName, 'Nome da loja');
      const tenantId = randomUUID(), userId = randomUUID(), created = new Date().toISOString();
      store.run('INSERT INTO tenants VALUES(?,?,?)', tenantId, tenantName, created);
      store.run(`INSERT INTO users(id,tenant_id,name,email,salt,password_hash,permissions,is_owner,created_at,auth_kind)
        VALUES(?,?,?,?,?,?,?,1,?,'google')`, userId, tenantId, name, email, randomBytes(16).toString('hex'), randomBytes(64).toString('hex'), '[]', created);
      store.run('INSERT INTO google_identities VALUES(?,?,?,?)', identity.sub, tenantId, userId, created);
      user = store.get('SELECT * FROM users WHERE id=?', userId);
      store.audit(user, 'tenant', tenantId, 'registered_google');
    }
    return store.newSession({ ...user, permissions: JSON.parse(user.permissions) });
  });
}
