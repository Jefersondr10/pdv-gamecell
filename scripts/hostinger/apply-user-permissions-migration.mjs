// Verify the prior migration and take its on-server online safety copy first.
await import('./apply-backup-alert-migration.mjs');
const { DatabaseSync } = await import('node:sqlite');
const { readFile } = await import('node:fs/promises');
const { createHash } = await import('node:crypto');
const db = new DatabaseSync(process.argv[2], { timeout: 5000 });
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
const name = '0011_user_function_permissions';
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
  let column = db
    .prepare('PRAGMA table_info(users)')
    .all()
    .find((row) => row.name === 'permissions_json');
  if (!column) {
    db.exec(sql);
    column = db
      .prepare('PRAGMA table_info(users)')
      .all()
      .find((row) => row.name === 'permissions_json');
  }
  if (
    column?.type !== 'TEXT' ||
    column.notnull !== 0 ||
    column.dflt_value !== null
  )
    throw new Error('Unexpected permissions schema.');
  if (db.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('Foreign key validation failed.');
  db.prepare('INSERT OR IGNORE INTO pdv_release_migrations VALUES(?,?,?)').run(
    name,
    checksum,
    Date.now(),
  );
  db.exec('COMMIT');
  console.log(
    'User permission migration verified. Existing accounts and data preserved.',
  );
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
