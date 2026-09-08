await import('./apply-user-permissions-migration.mjs');
const { DatabaseSync } = await import('node:sqlite');
const { readFile } = await import('node:fs/promises');
const { createHash } = await import('node:crypto');
const db = new DatabaseSync(process.argv[2], { timeout: 5000 });
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
const name = '0012_client_name_identity';
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
      .prepare('PRAGMA table_info(clients)')
      .all()
      .some((column) => column.name === 'name_key')
  )
    db.exec(sql);
  const column = db
    .prepare('PRAGMA table_info(clients)')
    .all()
    .find((column) => column.name === 'name_key');
  const index = db
    .prepare("PRAGMA index_list('clients')")
    .all()
    .find((index) => index.name === 'uq_clients_store_name_key');
  if (column?.type !== 'TEXT' || column.notnull !== 0 || index?.unique !== 1)
    throw new Error('Unexpected client identity schema.');
  if (
    JSON.stringify(
      db
        .prepare("PRAGMA index_info('uq_clients_store_name_key')")
        .all()
        .map((row) => row.name),
    ) !== JSON.stringify(['store_id', 'name_key'])
  )
    throw new Error('Unexpected client identity index columns.');
  if (db.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('Foreign key validation failed.');
  db.prepare('INSERT OR IGNORE INTO pdv_release_migrations VALUES(?,?,?)').run(
    name,
    checksum,
    Date.now(),
  );
  db.exec('COMMIT');
  db.exec('PRAGMA optimize;');
  console.log(
    'Client duplicate prevention verified. Existing client records preserved.',
  );
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
