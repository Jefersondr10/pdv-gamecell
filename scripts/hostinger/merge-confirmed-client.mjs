// Maintenance only: exact IDs for a duplicate explicitly confirmed by the store.
// Never groups customers by name, never alters financial snapshots or attachments.
import { DatabaseSync, backup } from 'node:sqlite';
import { access, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const [path, storeId, canonicalId, duplicateId, mode] = process.argv.slice(2);
if (
  !path ||
  !isAbsolute(path) ||
  !storeId ||
  !canonicalId ||
  !duplicateId ||
  canonicalId === duplicateId ||
  !['--check', '--apply'].includes(mode)
)
  throw new Error(
    'Provide absolute database path, store, canonical, duplicate and --check or --apply.',
  );
await access(path);
const db = new DatabaseSync(path, {
  readOnly: mode === '--check',
  timeout: 5000,
});
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
const normalized = (value) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
    .replace(/\s+/g, ' ');
function inspect() {
  const canonical = db
    .prepare('SELECT * FROM clients WHERE id=? AND store_id=?')
    .get(canonicalId, storeId);
  const duplicate = db
    .prepare('SELECT * FROM clients WHERE id=? AND store_id=?')
    .get(duplicateId, storeId);
  if (
    !canonical ||
    !duplicate ||
    normalized(canonical.name) !== normalized(duplicate.name) ||
    !canonical.active
  )
    throw new Error('Expected confirmed duplicate not found.');
  if (
    [canonical, duplicate].some(
      (client) => client.phone || client.email || client.notes,
    )
  )
    throw new Error('Contact/notes require separate review; no changes made.');
  const owner = db
    .prepare(
      "SELECT id FROM users WHERE store_id=? AND role='owner' ORDER BY created_at, id LIMIT 1",
    )
    .get(storeId);
  if (!owner) throw new Error('Store owner not found.');
  const sales = db
    .prepare(
      'SELECT * FROM sales WHERE store_id=? AND customer_id IN (?,?) ORDER BY id',
    )
    .all(storeId, canonicalId, duplicateId);
  if (!sales.length) throw new Error('Expected purchase history missing.');
  return { canonical, duplicate, owner, sales };
}
const digest = (rows) =>
  createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const initial = inspect();
if (mode === '--check') {
  console.log(
    JSON.stringify({
      ready: true,
      saleCount: initial.sales.length,
      productsTotalCents: initial.sales.reduce(
        (sum, sale) => sum + sale.products_total_cents,
        0,
      ),
    }),
  );
  db.close();
} else {
  const archive = join(dirname(path), 'backups');
  await mkdir(archive, { recursive: true, mode: 0o700 });
  const snapshot = join(
    archive,
    `pre-confirmed-client-merge-${Date.now()}.sqlite`,
  );
  await backup(db, snapshot);
  db.exec('BEGIN IMMEDIATE');
  try {
    const lockedState = inspect();
    if (digest(lockedState) !== digest(initial))
      throw new Error(
        'Customer history changed during backup. Review and retry; no changes made.',
      );
    const { canonical, duplicate, owner, sales } = lockedState;
    const movedIds = sales
      .filter((sale) => sale.customer_id === duplicateId)
      .map((sale) => sale.id);
    db.prepare(
      'UPDATE sales SET customer_id=? WHERE store_id=? AND customer_id=?',
    ).run(canonicalId, storeId, duplicateId);
    db.prepare('DELETE FROM clients WHERE id=? AND store_id=?').run(
      duplicateId,
      storeId,
    );
    db.prepare(
      'UPDATE clients SET name_key=?, updated_at=? WHERE id=? AND store_id=?',
    ).run(normalized(canonical.name), Date.now(), canonicalId, storeId);
    const after = db
      .prepare(
        'SELECT * FROM sales WHERE store_id=? AND customer_id=? ORDER BY id',
      )
      .all(storeId, canonicalId);
    if (
      digest(after) !==
      digest(sales.map((sale) => ({ ...sale, customer_id: canonicalId })))
    )
      throw new Error('Sales preservation check failed.');
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Foreign key validation failed.');
    db.prepare(
      'INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(
      randomUUID(),
      storeId,
      owner.id,
      'maintenance.client_duplicate_merged',
      'client',
      canonicalId,
      JSON.stringify({
        executedBy: 'Codex maintenance',
        authority:
          'User explicitly confirmed these records are the same customer',
        ownerIsCustodianNotExecutor: true,
        duplicateBefore: duplicate,
        canonicalBefore: canonical,
        movedSaleIds: movedIds,
        financialSnapshotsChanged: false,
        onServerBackup: snapshot,
      }),
      Date.now(),
    );
    db.exec('COMMIT');
    console.log(
      JSON.stringify({
        merged: true,
        duplicateRecordsRemoved: 1,
        movedSales: movedIds.length,
        saleCount: after.length,
        productsTotalCents: after.reduce(
          (sum, sale) => sum + sale.products_total_cents,
          0,
        ),
        backup: snapshot,
      }),
    );
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}
