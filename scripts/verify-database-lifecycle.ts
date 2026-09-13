import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  MIGRATION_TABLES,
  PRESERVED_INFRASTRUCTURE_TABLES,
  PRODUCTION_RESET_DELETE_ORDER,
} from '../lib/server/database-lifecycle.ts';

const migrations = readdirSync('drizzle')
  .filter((name) => /^\d+.*\.sql$/.test(name))
  .sort()
  .map((name) => readFileSync(`drizzle/${name}`, 'utf8'));
const schemaTables = new Set(
  migrations.flatMap((sql) =>
    [...sql.matchAll(/CREATE TABLE\s+[`"]?([a-z_][a-z0-9_]*)/gi)].map(
      (match) => match[1],
    ),
  ),
);

assert.deepEqual(
  [...MIGRATION_TABLES].sort(),
  [...schemaTables].sort(),
  'the migration export must contain every application table from Drizzle',
);
assert.deepEqual(
  [...PRODUCTION_RESET_DELETE_ORDER].sort(),
  [...schemaTables].sort(),
  'the production reset must clear every application table',
);
for (const table of PRESERVED_INFRASTRUCTURE_TABLES) {
  assert.ok(!MIGRATION_TABLES.includes(table as never));
  assert.ok(!PRODUCTION_RESET_DELETE_ORDER.includes(table as never));
}

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
for (const sql of migrations) db.exec(sql);
const positions = new Map<string, number>(
  PRODUCTION_RESET_DELETE_ORDER.map((table, index) => [table, index]),
);
for (const table of MIGRATION_TABLES) {
  const foreignKeys = db
    .prepare(`PRAGMA foreign_key_list("${table}")`)
    .all() as { table: string; on_delete: string }[];
  for (const foreignKey of foreignKeys) {
    if (
      positions.has(foreignKey.table) &&
      foreignKey.on_delete.toUpperCase() !== 'CASCADE'
    ) {
      assert.ok(
        positions.get(table)! < positions.get(foreignKey.table)!,
        `${table} must be cleared before ${foreignKey.table}`,
      );
    }
  }
}

db.exec(
  `CREATE TABLE pdv_release_migrations
   (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)`,
);
db.prepare(
  'INSERT INTO stores (id,name,code,created_at,updated_at) VALUES (?,?,?,?,?)',
).run('store', 'Store', 'store', 1, 1);
db.prepare(
  `INSERT INTO users
   (id,store_id,role,auth_kind,display_name,created_at,updated_at)
   VALUES (?,?,?,?,?,?,?)`,
).run('user', 'store', 'owner', 'password', 'Owner', 1, 1);
db.prepare(
  `INSERT INTO order_statuses
   (id,store_id,name,name_normalized,created_by,created_at,updated_at)
   VALUES (?,?,?,?,?,?,?)`,
).run('status', 'store', 'Separando', 'separando', 'user', 1, 1);
db.prepare(
  `INSERT INTO file_deletion_jobs
   (operation_id,r2_key,next_attempt_at,created_at) VALUES (?,?,?,?)`,
).run('delete', 'stores/store/file', 1, 1);
db.prepare(
  'INSERT INTO pdv_release_migrations VALUES (?,?,?)',
).run('0016', 'checksum', 1);

db.exec('BEGIN IMMEDIATE');
try {
  for (const table of PRODUCTION_RESET_DELETE_ORDER)
    db.exec(`DELETE FROM "${table}"`);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
assert.equal(
  (
    db.prepare('SELECT COUNT(*) AS count FROM order_statuses').get() as {
      count: number;
    }
  ).count,
  0,
);
assert.equal(
  (
    db.prepare('SELECT COUNT(*) AS count FROM file_deletion_jobs').get() as {
      count: number;
    }
  ).count,
  0,
);
assert.equal(
  (
    db
      .prepare('SELECT COUNT(*) AS count FROM pdv_release_migrations')
      .get() as { count: number }
  ).count,
  1,
  'release metadata must survive a data reset',
);
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
db.close();

console.log(
  'Database lifecycle passed: complete migration, FK-safe reset and preserved release metadata.',
);
