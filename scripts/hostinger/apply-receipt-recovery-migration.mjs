await import('./apply-receipt-identification-migration.mjs');
const { DatabaseSync } = await import('node:sqlite');
const { readFile } = await import('node:fs/promises');
const { createHash } = await import('node:crypto');
const db = new DatabaseSync(process.argv[2], { timeout: 5000 });
const name = '0016_automatic_receipt_recovery';
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
  if (!prior) db.exec(sql);
  const column = db
    .prepare('PRAGMA table_info(receipt_ocr_jobs)')
    .all()
    .find((c) => c.name === 'reader_revision');
  if (
    !column ||
    column.type !== 'INTEGER' ||
    column.notnull !== 1 ||
    String(column.dflt_value) !== '0'
  )
    throw new Error('Unexpected receipt reader revision column.');
  db.prepare('INSERT OR IGNORE INTO pdv_release_migrations VALUES(?,?,?)').run(
    name,
    checksum,
    Date.now(),
  );
  db.exec('COMMIT');
  console.log(
    'Automatic receipt recovery schema verified. Existing receipts and cash preserved.',
  );
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
