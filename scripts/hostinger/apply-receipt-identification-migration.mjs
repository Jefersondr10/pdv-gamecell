await import('./apply-receipt-payment-migration.mjs');
const { DatabaseSync } = await import('node:sqlite');
const { readFile } = await import('node:fs/promises');
const { createHash } = await import('node:crypto');
const db = new DatabaseSync(process.argv[2], { timeout: 5000 });
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
const name = '0015_receipt_identified_payments';
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
  for (const [table, names] of [
    ['attachments', ['receipt_details_json', 'receipt_review_reason']],
    ['pix_accounts', ['receipt_bank', 'receipt_recipient_document']],
  ]) {
    const columns = db.prepare(`PRAGMA table_info(${String(table)})`).all();
    if (
      names.some(
        (name) =>
          !columns.some(
            (c) => c.name === name && c.type === 'TEXT' && c.notnull === 0,
          ),
      )
    )
      throw new Error('Unexpected receipt identification columns.');
  }
  if (
    JSON.stringify(
      db
        .prepare('PRAGMA table_info(receipt_payment_links)')
        .all()
        .map((c) => [c.name, c.type, c.notnull, c.pk]),
    ) !==
    JSON.stringify([
      ['attachment_id', 'TEXT', 1, 1],
      ['store_id', 'TEXT', 1, 0],
      ['sale_id', 'TEXT', 1, 0],
      ['payment_id', 'TEXT', 1, 0],
      ['transaction_id', 'TEXT', 1, 0],
      ['created_at', 'INTEGER', 1, 0],
    ])
  )
    throw new Error('Unexpected receipt evidence schema.');
  for (const [name, fields] of [
    ['uq_receipt_payment_transaction', ['store_id', 'transaction_id']],
    ['uq_receipt_payment_payment', ['payment_id']],
    ['idx_receipt_payment_sale', ['sale_id', 'store_id']],
  ]) {
    if (
      JSON.stringify(
        db
          .prepare(`PRAGMA index_info('${String(name)}')`)
          .all()
          .map((c) => c.name),
      ) !== JSON.stringify(fields)
    )
      throw new Error('Unexpected evidence index.');
    if (
      name.startsWith('uq_') &&
      !db
        .prepare('PRAGMA index_list(receipt_payment_links)')
        .all()
        .some((i) => i.name === name && i.unique === 1)
    )
      throw new Error('Evidence index must remain unique.');
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('Foreign key validation failed.');
  db.prepare('INSERT OR IGNORE INTO pdv_release_migrations VALUES(?,?,?)').run(
    name,
    checksum,
    Date.now(),
  );
  db.exec('COMMIT');
  console.log(
    'Receipt identification schema verified. Existing sale values unchanged.',
  );
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
