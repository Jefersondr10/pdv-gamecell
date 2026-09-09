// The existing migration chain first creates an on-server SQLite safety copy.
await import('./apply-client-identity-migration.mjs');
const { DatabaseSync } = await import('node:sqlite');
const { readFile } = await import('node:fs/promises');
const { createHash } = await import('node:crypto');
const db = new DatabaseSync(process.argv[2], { timeout: 5000 });
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
const name = '0013_manual_receipt_deletion';
const sql = await readFile(
  new URL(`../../drizzle/${name}.sql`, import.meta.url),
  'utf8',
);
const checksum = createHash('sha256')
  .update(sql.replace(/\r\n/g, '\n'))
  .digest('hex');
db.exec('BEGIN IMMEDIATE');
try {
  const prior = db
    .prepare('SELECT checksum FROM pdv_release_migrations WHERE name=?')
    .get(name);
  if (prior && prior.checksum !== checksum)
    throw new Error('Migration checksum mismatch.');
  if (
    !db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name='file_deletion_jobs'",
      )
      .get()
  )
    db.exec(sql);
  const columns = db.prepare('PRAGMA table_info(file_deletion_jobs)').all();
  if (
    JSON.stringify(
      columns.map((row) => [row.name, row.type, row.notnull, row.pk]),
    ) !==
    JSON.stringify([
      ['operation_id', 'TEXT', 1, 1],
      ['r2_key', 'TEXT', 1, 0],
      ['attempts', 'INTEGER', 1, 0],
      ['next_attempt_at', 'INTEGER', 1, 0],
      ['created_at', 'INTEGER', 1, 0],
    ])
  )
    throw new Error('Unexpected file deletion schema.');
  if (
    JSON.stringify(
      db
        .prepare("PRAGMA index_info('idx_file_deletion_ready')")
        .all()
        .map((row) => row.name),
    ) !== JSON.stringify(['next_attempt_at'])
  )
    throw new Error('Unexpected file deletion index.');
  if (db.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('Foreign key validation failed.');
  db.prepare('INSERT OR IGNORE INTO pdv_release_migrations VALUES(?,?,?)').run(
    name,
    checksum,
    Date.now(),
  );
  db.exec('COMMIT');
  console.log(
    'Durable receipt file cleanup verified. Existing records preserved.',
  );
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
