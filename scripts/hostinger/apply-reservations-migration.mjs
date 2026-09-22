// Additive release migration, invoked only by the authorized deployment runner.
await import('./apply-public-reports-migration.mjs');
const { DatabaseSync } = await import('node:sqlite');
const { readFile } = await import('node:fs/promises');
const { createHash } = await import('node:crypto');
const db = new DatabaseSync(process.argv[2], { timeout: 5000 });
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
const name = '0018_stock_reservations';
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
  for (const [table, columns] of [
    [
      'stock_reservations',
      [
        'id',
        'store_id',
        'customer_id',
        'customer_name',
        'created_by',
        'expires_at',
        'status',
        'sale_id',
        'notes',
        'revision',
        'fingerprint',
        'created_at',
        'updated_at',
      ],
    ],
    ['stock_reservation_items', ['reservation_id', 'inventory_unit_id']],
  ]) {
    if (
      JSON.stringify(
        db
          .prepare(`PRAGMA table_info(${String(table)})`)
          .all()
          .map((column) => column.name),
      ) !== JSON.stringify(columns)
    )
      throw new Error('Unexpected reservation schema.');
  }
  for (const [type, name] of [
    ['index', 'idx_stock_reservations_store'],
    ['index', 'idx_stock_reservation_unit'],
    ['trigger', 'stock_reservation_claim'],
    ['trigger', 'stock_reservation_sale_guard'],
  ]) {
    if (
      !db
        .prepare('SELECT name FROM sqlite_schema WHERE type=? AND name=?')
        .get(type, name)
    )
      throw new Error('Reservation stock guard or index missing.');
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('Foreign key check failed.');
  db.prepare('INSERT OR IGNORE INTO pdv_release_migrations VALUES(?,?,?)').run(
    name,
    checksum,
    Date.now(),
  );
  db.exec('COMMIT');
  console.log(
    'Reservation schema ready; existing sales, payments and inventory preserved.',
  );
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
