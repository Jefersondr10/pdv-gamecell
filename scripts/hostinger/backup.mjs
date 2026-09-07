import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access, readdir, unlink, open, stat, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'node:zlib';

const [action, dataArgument, configArgument, snapshotHash] = process.argv.slice(2);
const directory = resolve(dataArgument);
const configPath = resolve(configArgument);
if (action === 'init') {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(configPath, JSON.stringify({ token: randomBytes(32).toString('base64url'), key: randomBytes(32).toString('base64'), origin: 'https://pdv-estoque-apple.jefersondr10.chatgpt.site' }), { flag: 'wx', mode: 0o600 });
  console.log('Private off-site backup keys created.');
  process.exit(0);
}
const config = JSON.parse(await readFile(configPath, 'utf8'));
const encryptionKey = Buffer.from(config.key, 'base64');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const encrypt = (bytes) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(gzipSync(bytes)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
};
const decrypt = (bytes) => {
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return gunzipSync(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]));
};
async function transfer(kind, bytes) {
  const digest = hash(bytes);
  if (kind === 'objects') {
    const existing = await fetch(`${config.origin}/api/system/vps-backup?kind=${kind}&hash=${digest}`, {
      method: 'HEAD', headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(30_000),
    });
    if (existing.ok) return digest;
    if (existing.status !== 404) throw new Error(`Off-site object check failed: ${existing.status}`);
  }
  const response = await fetch(`${config.origin}/api/system/vps-backup?kind=${kind}&hash=${digest}`, {
    method: 'POST', headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/octet-stream' }, body: bytes, signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Off-site upload failed: ${response.status}`);
  return digest;
}
async function transferLarge(path) {
  const parts = [];
  const file = await open(path, 'r');
  const digest = createHash('sha256');
  let size = 0;
  try {
    const buffer = Buffer.alloc(8 * 1024 * 1024);
    while (true) {
      const { bytesRead } = await file.read(buffer);
      if (!bytesRead) break;
      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk); size += bytesRead;
      parts.push(await transfer('objects', encrypt(chunk)));
    }
  } finally { await file.close(); }
  return { parts, size, digest: digest.digest('hex') };
}
async function restoreLarge(reference, path) {
  if (typeof reference === 'string') {
    await writeFile(path, await retrieve('objects', reference), { flag: 'wx', mode: 0o600 });
    return;
  }
  if (!Array.isArray(reference.parts) || !reference.parts.length) throw new Error('Invalid multipart backup');
  const file = await open(path, 'wx', 0o600);
  const digest = createHash('sha256');
  let size = 0;
  try {
    for (const part of reference.parts) {
      const bytes = await retrieve('objects', part);
      digest.update(bytes); size += bytes.length;
      await file.writeFile(bytes);
    }
    await file.sync();
  } finally { await file.close(); }
  if (size !== reference.size || digest.digest('hex') !== reference.digest) throw new Error('Multipart backup integrity mismatch');
}
async function retrieve(kind, digest) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid backup digest');
  const response = await fetch(`${config.origin}/api/system/vps-backup?kind=${kind}&hash=${digest}`, { headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Off-site download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== digest) throw new Error('Encrypted backup integrity mismatch');
  return decrypt(bytes);
}
if (action === 'create') {
  const archive = join(directory, 'backups');
  const capturedAt = Date.now();
  await mkdir(archive, { recursive: true, mode: 0o700 });
  const oldSnapshots = (await readdir(archive)).filter((name) => /^snapshot-\d+\.sqlite$/.test(name)).sort().reverse();
  for (const name of oldSnapshots.slice(2)) {
    const timestamp = Number(/^snapshot-(\d+)\.sqlite$/.exec(name)[1]);
    if (timestamp < capturedAt - 48 * 60 * 60 * 1000) await unlink(join(archive, name));
  }
  const disk = await statfs(directory);
  const databaseSize = (await stat(join(directory, 'pdv.sqlite'))).size;
  if (disk.bavail * disk.bsize < Math.max(512 * 1024 * 1024, databaseSize * 2)) throw new Error('Insufficient free disk for a safe backup');
  const source = new DatabaseSync(join(directory, 'pdv.sqlite'), { readOnly: true });
  const snapshotPath = join(archive, `snapshot-${capturedAt}.sqlite`);
  await backup(source, snapshotPath);
  source.close();
  const db = new DatabaseSync(snapshotPath, { readOnly: true });
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup database integrity failed');
  const manifest = { version: 2, capturedAt, files: [], database: await transferLarge(snapshotPath),
    environment: await transfer('objects', encrypt(await readFile(join(directory, '.env.runtime')))) };
  for (const row of db.prepare('SELECT r2_key AS key FROM attachments').all()) {
    const basename = hash(row.key);
    const metadata = JSON.parse(await readFile(join(directory, 'objects', `${basename}.json`), 'utf8'));
    const referencePath = join(archive, `reference-${metadata.etag}.enc`);
    let reference;
    try { reference = JSON.parse(decrypt(await readFile(referencePath))); }
    catch { reference = null; }
    if (reference?.etag === metadata.etag && reference?.size === metadata.size && /^[a-f0-9]{64}$/.test(reference.object)) {
      const existing = await fetch(`${config.origin}/api/system/vps-backup?kind=objects&hash=${reference.object}`, {
        method: 'HEAD', headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(30_000),
      });
      if (existing.ok) {
        manifest.files.push({ basename, metadata, object: reference.object });
        continue;
      }
      if (existing.status !== 404) throw new Error(`Off-site object check failed: ${existing.status}`);
    }
    const blob = await readFile(join(directory, 'objects', `${basename}.blob`));
    if (blob.length !== metadata.size || hash(blob) !== metadata.etag) throw new Error('Backup file integrity failed');
    const cachePath = join(archive, `object-${metadata.etag}.enc`);
    let encrypted;
    try {
      encrypted = await readFile(cachePath);
      try { if (hash(decrypt(encrypted)) !== metadata.etag) throw new Error('Invalid cache'); }
      catch { encrypted = encrypt(blob); await writeFile(cachePath, encrypted, { mode: 0o600 }); }
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; encrypted = encrypt(blob); await writeFile(cachePath, encrypted, { mode: 0o600 }); }
    // Reuse identical encrypted bytes so append-only off-site objects deduplicate.
    const object = await transfer('objects', encrypted);
    await writeFile(referencePath, encrypt(Buffer.from(JSON.stringify({ etag: metadata.etag, size: metadata.size, object }))), { mode: 0o600 });
    manifest.files.push({ basename, metadata, object });
  }
  db.close();
  const encrypted = encrypt(Buffer.from(JSON.stringify(manifest)));
  const digest = await transfer('snapshots', encrypted);
  await writeFile(join(archive, `manifest-${capturedAt}.enc`), encrypted, { mode: 0o600 });
  await writeFile(join(archive, 'last-success.json'), JSON.stringify({ capturedAt, snapshot: digest, files: manifest.files.length }), { mode: 0o600 });
  // Prune only our timestamped local snapshots after a successful off-site upload.
  // Immutable attachment cache is retained; previous off-site backups cannot be deleted here.
  for (const name of await readdir(archive)) {
    const match = /^(?:snapshot-(\d+)\.sqlite|manifest-(\d+)\.enc)$/.exec(name);
    if (match && Number(match[1] ?? match[2]) < capturedAt - 48 * 60 * 60 * 1000) await unlink(join(archive, name));
  }
  console.log(JSON.stringify({ ok: true, snapshot: digest, files: manifest.files.length, capturedAt }));
} else if (action === 'restore') {
  try { await access(join(directory, 'pdv.sqlite')); throw new Error('Refusing to overwrite an existing database'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { if ((await readdir(directory)).length) throw new Error('Restore requires a new empty directory'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const manifest = JSON.parse(await retrieve('snapshots', snapshotHash));
  await mkdir(join(directory, 'objects'), { recursive: true, mode: 0o700 });
  await restoreLarge(manifest.database, join(directory, 'pdv.sqlite'));
  await writeFile(join(directory, '.env.runtime'), await retrieve('objects', manifest.environment), { flag: 'wx', mode: 0o600 });
  for (const file of manifest.files) {
    if (!/^[a-f0-9]{64}$/.test(file.basename) || hash(file.metadata.key) !== file.basename) throw new Error('Invalid backup object path');
    const bytes = await retrieve('objects', file.object);
    if (hash(bytes) !== file.metadata.etag || bytes.length !== file.metadata.size) throw new Error('Restored object integrity mismatch');
    await writeFile(join(directory, 'objects', `${file.basename}.blob`), bytes, { mode: 0o600 });
    await writeFile(join(directory, 'objects', `${file.basename}.json`), JSON.stringify(file.metadata), { mode: 0o600 });
  }
  const db = new DatabaseSync(join(directory, 'pdv.sqlite'), { readOnly: true });
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Restored database validation failed');
  const expectedFiles = db.prepare('SELECT r2_key AS key FROM attachments').all().map((row) => hash(row.key)).sort();
  if (JSON.stringify(expectedFiles) !== JSON.stringify(manifest.files.map((file) => file.basename).sort())) throw new Error('Restored attachment set does not match the database');
  db.close();
  console.log(JSON.stringify({ restored: true, files: manifest.files.length, capturedAt: manifest.capturedAt }));
} else { throw new Error('Unknown action'); }
