import { DatabaseSync, backup } from 'node:sqlite';
import { readFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, dirname, join } from 'node:path';
const path = process.argv[2];
if (!path || !isAbsolute(path))
  throw new Error('Provide existing absolute database path.');
await access(path);
const db = new DatabaseSync(path, { timeout: 5000 });
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
for (const name of [
  'stores',
  'users',
  'audit_events',
  'receipt_ocr_jobs',
  'pdv_release_migrations',
])
  if (
    !db
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?")
      .get(name)
  )
    throw new Error('Unexpected database schema.');
const sql = await readFile(
  new URL('../../drizzle/0010_backup_alert_destinations.sql', import.meta.url),
  'utf8',
);
const digest = createHash('sha256')
  .update(sql.replace(/\r\n/g, '\n'))
  .digest('hex');
const archive = join(dirname(path), 'backups');
await mkdir(archive, { recursive: true, mode: 0o700 });
await backup(
  db,
  join(archive, `pre-backup-alert-settings-${Date.now()}.sqlite`),
);
db.exec('BEGIN IMMEDIATE');
try {
  if (
    !db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name='store_backup_alert_settings'",
      )
      .get()
  )
    db.exec(sql);
  const columns = db
    .prepare('PRAGMA table_info(store_backup_alert_settings)')
    .all()
    .map((row) => row.name);
  if (
    JSON.stringify(columns) !==
    JSON.stringify([
      'store_id',
      'email',
      'revision',
      'updated_by',
      'mutation_id',
      'created_at',
      'updated_at',
    ])
  )
    throw new Error('Unexpected settings schema.');
  if (db.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('Foreign key validation failed.');
  const prior = db
    .prepare('SELECT checksum FROM pdv_release_migrations WHERE name=?')
    .get('0010_backup_alert_destinations');
  if (prior && prior.checksum !== digest)
    throw new Error('Migration checksum mismatch.');
  db.prepare('INSERT OR IGNORE INTO pdv_release_migrations VALUES(?,?,?)').run(
    '0010_backup_alert_destinations',
    digest,
    Date.now(),
  );
  db.exec('COMMIT');
  console.log(
    'Backup alert settings migration verified. Existing data preserved.',
  );
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
