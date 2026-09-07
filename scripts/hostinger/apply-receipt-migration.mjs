import { DatabaseSync, backup } from 'node:sqlite';
import { readFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, dirname, join } from 'node:path';

const path = process.argv[2];
if (!path || !isAbsolute(path))
  throw new Error('Provide an existing absolute database path.');
await access(path);
const db = new DatabaseSync(path, { timeout: 5000 });
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
for (const table of ['sales', 'attachments', 'inventory_units', 'users'])
  if (
    !db
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?")
      .get(table)
  )
    throw new Error('Unexpected database schema.');
const sql = await readFile(
  new URL('../../drizzle/0009_durable_receipt_jobs.sql', import.meta.url),
  'utf8',
);
const digest = createHash('sha256')
  .update(sql.replace(/\r\n/g, '\n'))
  .digest('hex');
const archive = join(dirname(path), 'backups');
await mkdir(archive, { recursive: true, mode: 0o700 });
await backup(db, join(archive, `pre-receipt-migration-${Date.now()}.sqlite`));
db.exec('BEGIN IMMEDIATE');
try {
  if (
    !db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name='receipt_ocr_jobs'",
      )
      .get()
  )
    db.exec(sql);
  const columns = db
    .prepare('PRAGMA table_info(receipt_ocr_jobs)')
    .all()
    .map((row) => row.name);
  if (
    JSON.stringify(columns) !==
    JSON.stringify([
      'attachment_id',
      'status',
      'attempts',
      'generation',
      'lease_token',
      'lease_until',
      'next_attempt_at',
      'error_code',
      'confidence',
      'created_at',
      'updated_at',
    ])
  )
    throw new Error('Unexpected receipt job schema.');
  if (
    !db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='index' AND name='idx_receipt_ocr_ready'",
      )
      .get()
  )
    throw new Error('Receipt job index missing.');
  if (db.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('Foreign key validation failed.');
  db.exec(
    'CREATE TABLE IF NOT EXISTS pdv_release_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)',
  );
  const prior = db
    .prepare('SELECT checksum FROM pdv_release_migrations WHERE name=?')
    .get('0009_durable_receipt_jobs');
  if (prior && prior.checksum !== digest)
    throw new Error('Migration checksum mismatch.');
  db.prepare(
    'INSERT OR IGNORE INTO pdv_release_migrations VALUES (?, ?, ?)',
  ).run('0009_durable_receipt_jobs', digest, Date.now());
  db.exec('COMMIT');
  console.log('Receipt job migration verified. Existing records preserved.');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
