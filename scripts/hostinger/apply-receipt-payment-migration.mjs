// Existing chain first makes an online on-server SQLite safety copy.
await import('./apply-receipt-delete-migration.mjs');
const { DatabaseSync } = await import('node:sqlite');
const { readFile } = await import('node:fs/promises');
const { createHash } = await import('node:crypto');
const db = new DatabaseSync(process.argv[2], { timeout: 5000 });
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
const name = '0014_receipt_payment_sync';
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
        "SELECT name FROM sqlite_schema WHERE type='table' AND name='sale_receipt_payment_sync'",
      )
      .get()
  )
    db.exec(sql);
  const columns = db
    .prepare('PRAGMA table_info(sale_receipt_payment_sync)')
    .all();
  if (
    JSON.stringify(
      columns.map((row) => [row.name, row.type, row.notnull, row.pk]),
    ) !==
    JSON.stringify([
      ['sale_id', 'TEXT', 1, 1],
      ['store_id', 'TEXT', 1, 0],
      ['request_id', 'TEXT', 1, 0],
      ['requested_by', 'TEXT', 1, 0],
      ['target_payment_id', 'TEXT', 0, 0],
      ['status', 'TEXT', 1, 0],
      ['updated_at', 'INTEGER', 1, 0],
    ])
  )
    throw new Error('Unexpected receipt payment schema.');
  if (
    JSON.stringify(
      db
        .prepare("PRAGMA index_info('idx_receipt_payment_pending')")
        .all()
        .map((row) => row.name),
    ) !== JSON.stringify(['status', 'updated_at'])
  )
    throw new Error('Unexpected receipt payment index.');
  if (db.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('Foreign key validation failed.');
  db.prepare('INSERT OR IGNORE INTO pdv_release_migrations VALUES(?,?,?)').run(
    name,
    checksum,
    Date.now(),
  );
  db.exec('COMMIT');
  console.log(
    'Receipt payment synchronization schema verified. Existing payments unchanged.',
  );
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
