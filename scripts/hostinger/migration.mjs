import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FileObjectStore } from '../../lib/server/node/object-store.mjs';

const [action, directoryArgument, targetArgument] = process.argv.slice(2);
if (!directoryArgument) throw new Error('Provide a private migration directory.');
const directory = resolve(directoryArgument);
const configPath = join(directory, 'export-config.json');
await mkdir(directory, { recursive: true, mode: 0o700 });
if (action === 'init') {
  await writeFile(configPath, JSON.stringify({ token: randomBytes(32).toString('base64url'), expiresAt: Date.now() + 6 * 3600_000 }), { flag: 'wx', mode: 0o600 });
  console.log('Private export configuration created.');
  process.exit(0);
}
const config = JSON.parse(await readFile(configPath, 'utf8'));
const key = await webcrypto.subtle.importKey('raw', Buffer.from(config.token, 'base64url'), 'AES-GCM', false, ['decrypt']);
async function unpack(envelope) {
  return Buffer.from(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64url') }, key, Buffer.from(envelope.data, 'base64')));
}
async function decryptFile(path) { return unpack(JSON.parse(await readFile(path, 'utf8'))); }
async function fetchExport(origin, body, path) {
  const response = await fetch(`${origin}/api/system/migration-export`, {
    method: 'POST', headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Export ${body.action} failed: HTTP ${response.status}`);
  const iv = response.headers.get('x-export-iv');
  if (!iv) throw new Error('Unencrypted export refused');
  const envelope = { iv, data: Buffer.from(await response.arrayBuffer()).toString('base64') };
  const bytes = await unpack(envelope);
  await writeFile(`${path}.tmp`, JSON.stringify(envelope), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
  return bytes;
}
if (action === 'export') {
  const origin = new URL(targetArgument).origin;
  if (!origin.startsWith('https://') && !origin.includes('localhost')) throw new Error('HTTPS required');
  const manifest = JSON.parse(await fetchExport(origin, { action: 'manifest' }, join(directory, 'manifest.enc')));
  await mkdir(join(directory, 'tables'), { recursive: true, mode: 0o700 });
  await mkdir(join(directory, 'files'), { recursive: true, mode: 0o700 });
  const attachments = [];
  for (const table of manifest.tables) {
    let count = 0;
    for (let offset = 0; offset < table.count; offset += 250) {
      const result = JSON.parse(await fetchExport(origin, { action: 'table', table: table.name, offset }, join(directory, 'tables', `${table.name}-${offset}.enc`)));
      count += result.rows.length;
      if (table.name === 'attachments') attachments.push(...result.rows);
    }
    if (count !== table.count) throw new Error(`Row count changed: ${table.name}`);
    console.log(`${table.name}: ${count} rows`);
  }
  const files = [];
  for (const attachment of attachments) {
    const filename = `${createHash('sha256').update(attachment.id).digest('hex')}.enc`;
    const path = join(directory, 'files', filename);
    let bytes;
    try { bytes = await decryptFile(path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; bytes = await fetchExport(origin, { action: 'file', id: attachment.id }, path); }
    if (bytes.length !== attachment.size_bytes) throw new Error(`Attachment size mismatch: ${attachment.id}`);
    files.push({ filename, id: attachment.id, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await writeFile(join(directory, 'verification.json'), JSON.stringify({ capturedAt: manifest.capturedAt, readOnly: manifest.readOnly, files, tables: manifest.tables }, null, 2), { mode: 0o600 });
  console.log(`Verified ${files.length} attachments. Frozen snapshot: ${manifest.readOnly}`);
} else if (action === 'import') {
  const target = resolve(targetArgument);
  await mkdir(target, { recursive: true, mode: 0o700 });
  try { await access(join(target, 'pdv.sqlite')); throw new Error('Refusing to overwrite an existing database. Use a NEW recovery directory.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const manifest = JSON.parse(await decryptFile(join(directory, 'manifest.enc')));
  const verification = JSON.parse(await readFile(join(directory, 'verification.json'), 'utf8'));
  if (verification.capturedAt !== manifest.capturedAt) throw new Error('Export verification does not match snapshot.');
  const db = new DatabaseSync(join(target, 'pdv.sqlite'));
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
  try {
    for (const item of manifest.schema) {
      if (!manifest.tables.some((table) => table.name === item.tableName) || !/^CREATE (?:UNIQUE )?(?:TABLE|INDEX) /i.test(item.sql)) throw new Error('Unexpected schema operation');
      db.exec(item.sql);
    }
    for (const table of manifest.tables) {
      let count = 0;
      for (let offset = 0; offset < table.count; offset += 250) {
        const { rows } = JSON.parse(await decryptFile(join(directory, 'tables', `${table.name}-${offset}.enc`)));
        for (const row of rows) {
          const columns = Object.keys(row);
          if (columns.some((column) => !/^[a-z_][a-z0-9_]*$/.test(column))) throw new Error('Invalid column');
          db.prepare(`INSERT INTO "${table.name}" (${columns.map((column) => `"${column}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row));
          count++;
        }
      }
      if (count !== table.count) throw new Error(`Import count mismatch ${table.name}`);
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key validation failed');
    db.exec('COMMIT; PRAGMA foreign_keys=ON;');
    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (integrity.integrity_check !== 'ok') throw new Error('Integrity validation failed');
    const store = new FileObjectStore(join(target, 'objects'));
    for (const file of verification.files) {
      const attachment = db.prepare('SELECT * FROM attachments WHERE id = ?').get(file.id);
      if (!attachment) throw new Error('Missing attachment reference');
      const bytes = await decryptFile(join(directory, 'files', file.filename));
      if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Attachment hash mismatch');
      await store.put(attachment.r2_key, bytes, { httpMetadata: { contentType: attachment.mime_type }, customMetadata: { originalName: attachment.file_name } });
    }
    await writeFile(join(target, '.env.runtime'), Object.entries(manifest.environment).map(([name, value]) => {
      if (/[\r\n]/.test(value)) throw new Error('Invalid environment value');
      return `${name}=${value}`;
    }).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ integrity: 'ok', files: verification.files.length, tables: manifest.tables,
      totals: db.prepare('SELECT COUNT(*) AS sales, SUM(products_total_cents) AS sold, SUM(received_total_cents) AS paid FROM sales').get(),
      stock: db.prepare('SELECT status, COUNT(*) AS count FROM inventory_units GROUP BY status').all() }));
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  finally { db.close(); }
} else { throw new Error('Unknown action'); }
