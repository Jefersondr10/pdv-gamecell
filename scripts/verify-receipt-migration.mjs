import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
const directory = await mkdtemp(join(tmpdir(), 'pdv-receipt-migration-test-'));
const path = join(directory, 'fixture.sqlite');
let db = new DatabaseSync(path);
for (const file of (await readdir('drizzle'))
  .filter((name) => /^000[0-8]_.*\.sql$/.test(name))
  .sort())
  db.exec(await readFile(join('drizzle', file), 'utf8'));
db.exec(
  "CREATE TABLE fixture_preservation (value TEXT); INSERT INTO fixture_preservation VALUES ('synthetic-record');",
);
db.close();
const migrate = () =>
  execFileSync(
    process.execPath,
    [resolve('scripts/hostinger/apply-receipt-migration.mjs'), path],
    { stdio: 'pipe' },
  );
migrate();
migrate();
db = new DatabaseSync(path);
assert.equal(
  db.prepare('SELECT value FROM fixture_preservation').get().value,
  'synthetic-record',
);
assert.equal(
  db.prepare('SELECT COUNT(*) AS count FROM pdv_release_migrations').get()
    .count,
  1,
);
assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
assert.equal(
  db.prepare('PRAGMA table_info(receipt_ocr_jobs)').all().length,
  11,
);
assert.equal(
  (await readdir(join(directory, 'backups'))).filter((file) =>
    file.endsWith('.sqlite'),
  ).length,
  2,
);
db.close();
const migrateAlerts = () =>
  execFileSync(
    process.execPath,
    [resolve('scripts/hostinger/apply-backup-alert-migration.mjs'), path],
    { stdio: 'pipe' },
  );
migrateAlerts();
migrateAlerts();
db = new DatabaseSync(path);
assert.equal(
  db.prepare('SELECT count(*) AS n FROM store_backup_alert_settings').get().n,
  0,
);
assert.equal(
  db.prepare('SELECT count(*) AS n FROM pdv_release_migrations').get().n,
  2,
);
assert.equal(
  db.prepare('SELECT value FROM fixture_preservation').get().value,
  'synthetic-record',
);
db.close();
const migratePermissions = () =>
  execFileSync(
    process.execPath,
    [resolve('scripts/hostinger/apply-user-permissions-migration.mjs'), path],
    { stdio: 'pipe' },
  );
migratePermissions();
migratePermissions();
db = new DatabaseSync(path);
assert.equal(
  db.prepare('SELECT count(*) AS n FROM pdv_release_migrations').get().n,
  3,
);
assert.equal(
  db
    .prepare('PRAGMA table_info(users)')
    .all()
    .find((row) => row.name === 'permissions_json').dflt_value,
  null,
);
assert.equal(
  db.prepare('SELECT value FROM fixture_preservation').get().value,
  'synthetic-record',
);
db.prepare('UPDATE pdv_release_migrations SET checksum=?').run('changed');
db.close();
assert.throws(migrate, /Migration checksum mismatch/);
assert.throws(migrateAlerts, /Migration checksum mismatch/);
assert.throws(migratePermissions, /Migration checksum mismatch/);
console.log(
  'Additive migration, preservation, backups, repeat and checksum rejection passed.',
);
