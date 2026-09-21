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
db.close();
const migrateClientIdentity = () =>
  execFileSync(
    process.execPath,
    [resolve('scripts/hostinger/apply-client-identity-migration.mjs'), path],
    { stdio: 'pipe' },
  );
migrateClientIdentity();
migrateClientIdentity();
db = new DatabaseSync(path);
assert.equal(
  db.prepare('SELECT count(*) AS n FROM pdv_release_migrations').get().n,
  4,
);
assert.deepEqual(
  db
    .prepare("PRAGMA index_info('uq_clients_store_name_key')")
    .all()
    .map((row) => row.name),
  ['store_id', 'name_key'],
);
assert.equal(
  db.prepare('SELECT value FROM fixture_preservation').get().value,
  'synthetic-record',
);
db.close();
const migrateReceiptDeletion = () =>
  execFileSync(
    process.execPath,
    [resolve('scripts/hostinger/apply-receipt-delete-migration.mjs'), path],
    { stdio: 'pipe' },
  );
migrateReceiptDeletion();
migrateReceiptDeletion();
db = new DatabaseSync(path);
assert.equal(
  db.prepare('SELECT count(*) AS n FROM pdv_release_migrations').get().n,
  5,
);
assert.equal(
  db.prepare('PRAGMA table_info(file_deletion_jobs)').all().length,
  5,
);
assert.equal(
  db.prepare('SELECT value FROM fixture_preservation').get().value,
  'synthetic-record',
);
assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
const deletionChecksum = db
  .prepare('SELECT checksum FROM pdv_release_migrations WHERE name=?')
  .get('0013_manual_receipt_deletion').checksum;
db.prepare('UPDATE pdv_release_migrations SET checksum=? WHERE name=?').run(
  'changed',
  '0013_manual_receipt_deletion',
);
db.close();
assert.throws(migrateReceiptDeletion, /Migration checksum mismatch/);
db = new DatabaseSync(path);
db.prepare('UPDATE pdv_release_migrations SET checksum=? WHERE name=?').run(
  deletionChecksum,
  '0013_manual_receipt_deletion',
);
db.close();
const migratePaymentSync = () =>
  execFileSync(
    process.execPath,
    [resolve('scripts/hostinger/apply-receipt-payment-migration.mjs'), path],
    { stdio: 'pipe' },
  );
migratePaymentSync();
migratePaymentSync();
db = new DatabaseSync(path);
assert.equal(
  db.prepare('SELECT count(*) AS n FROM pdv_release_migrations').get().n,
  6,
);
assert.equal(
  db.prepare('PRAGMA table_info(sale_receipt_payment_sync)').all().length,
  7,
);
assert.equal(
  db.prepare('SELECT count(*) AS n FROM sale_receipt_payment_sync').get().n,
  0,
);
assert.equal(
  db.prepare('SELECT value FROM fixture_preservation').get().value,
  'synthetic-record',
);
const syncChecksum = db
  .prepare('SELECT checksum FROM pdv_release_migrations WHERE name=?')
  .get('0014_receipt_payment_sync').checksum;
db.prepare('UPDATE pdv_release_migrations SET checksum=? WHERE name=?').run(
  'changed',
  '0014_receipt_payment_sync',
);
db.close();
assert.throws(migratePaymentSync, /Migration checksum mismatch/);
db = new DatabaseSync(path);
db.prepare('UPDATE pdv_release_migrations SET checksum=? WHERE name=?').run(
  syncChecksum,
  '0014_receipt_payment_sync',
);
db.close();
const migrateIdentification = () =>
  execFileSync(
    process.execPath,
    [
      resolve('scripts/hostinger/apply-receipt-identification-migration.mjs'),
      path,
    ],
    { stdio: 'pipe' },
  );
migrateIdentification();
migrateIdentification();
db = new DatabaseSync(path);
assert.equal(
  db.prepare('SELECT count(*) AS n FROM pdv_release_migrations').get().n,
  7,
);
assert.equal(
  db.prepare('SELECT count(*) AS n FROM receipt_payment_links').get().n,
  0,
);
assert.equal(
  db.prepare('SELECT value FROM fixture_preservation').get().value,
  'synthetic-record',
);
assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
const identificationChecksum = db
  .prepare('SELECT checksum FROM pdv_release_migrations WHERE name=?')
  .get('0015_receipt_identified_payments').checksum;
db.prepare('UPDATE pdv_release_migrations SET checksum=? WHERE name=?').run(
  'changed',
  '0015_receipt_identified_payments',
);
db.close();
assert.throws(migrateIdentification, /Migration checksum mismatch/);
db = new DatabaseSync(path);
db.prepare('UPDATE pdv_release_migrations SET checksum=? WHERE name=?').run(
  identificationChecksum,
  '0015_receipt_identified_payments',
);
db.close();
const migrateReports = () =>
  execFileSync(
    process.execPath,
    [resolve('scripts/hostinger/apply-public-reports-migration.mjs'), path],
    { stdio: 'pipe' },
  );
migrateReports();
migrateReports();
db = new DatabaseSync(path);
assert.equal(
  db.prepare('SELECT count(*) AS n FROM pdv_release_migrations').get().n,
  9,
);
assert.equal(db.prepare('SELECT count(*) AS n FROM report_shares').get().n, 0);
assert.equal(
  db.prepare('SELECT value FROM fixture_preservation').get().value,
  'synthetic-record',
);
assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
const reportChecksum = db
  .prepare('SELECT checksum FROM pdv_release_migrations WHERE name=?')
  .get('0017_public_report_links').checksum;
db.prepare('UPDATE pdv_release_migrations SET checksum=? WHERE name=?').run(
  'changed',
  '0017_public_report_links',
);
db.close();
assert.throws(migrateReports, /Migration checksum mismatch/);
db = new DatabaseSync(path);
db.prepare('UPDATE pdv_release_migrations SET checksum=? WHERE name=?').run(
  reportChecksum,
  '0017_public_report_links',
);
db.prepare('UPDATE pdv_release_migrations SET checksum=?').run('changed');
db.close();
// The legacy 0009 runner rejects the newer reader_revision column added by 0016.
assert.throws(migrate, /Unexpected receipt job schema/);
assert.throws(migrateAlerts, /Migration checksum mismatch/);
assert.throws(migratePermissions, /Migration checksum mismatch/);
assert.throws(migrateClientIdentity, /Migration checksum mismatch/);
assert.throws(migrateReceiptDeletion, /Migration checksum mismatch/);
console.log(
  'Additive migration, preservation, backups, repeat and checksum rejection passed.',
);
