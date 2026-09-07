import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const directory = await mkdtemp(join(tmpdir(), 'pdv-backup-test-'));
const source = join(directory, 'source');
await mkdir(join(source, 'objects'), { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = new Map();
let uploaded = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const key = `${url.searchParams.get('kind')}/${url.searchParams.get('hash')}`;
  if (req.method === 'POST') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    assert.ok(bytes.length < 16 * 1024 * 1024);
    assert.ok(key.endsWith(hash(bytes)));
    files.set(key, bytes); uploaded += 1; res.end('{}'); return;
  }
  const bytes = files.get(key);
  res.statusCode = bytes ? 200 : 404;
  res.end(req.method === 'HEAD' ? undefined : bytes);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const config = join(directory, 'config.json');
await writeFile(config, JSON.stringify({ token: randomBytes(32).toString('base64url'), key: randomBytes(32).toString('base64'), origin: `http://127.0.0.1:${server.address().port}` }));
const key = 'store/example-photo.jpg';
const blob = randomBytes(10000);
const metadata = { key, size: blob.length, etag: hash(blob), uploaded: new Date().toISOString(), httpMetadata: { contentType: 'image/jpeg' } };
await writeFile(join(source, 'objects', `${hash(key)}.blob`), blob);
await writeFile(join(source, 'objects', `${hash(key)}.json`), JSON.stringify(metadata));
await writeFile(join(source, '.env.runtime'), 'TEST_SECRET=preserved\n');
const db = new DatabaseSync(join(source, 'pdv.sqlite'));
db.exec('CREATE TABLE attachments(r2_key TEXT NOT NULL); CREATE TABLE test_payload(value BLOB);');
db.prepare('INSERT INTO attachments VALUES (?)').run(key);
db.prepare('INSERT INTO test_payload VALUES (?)').run(randomBytes(20 * 1024 * 1024));
db.close();
async function run(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/hostinger/backup.mjs', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(JSON.parse(stdout.trim())) : reject(new Error(stderr)));
  });
}
try {
  const first = await run('create', source, config);
  const count = uploaded;
  await run('create', source, config);
  assert.equal(uploaded - count, count - 1, 'unchanged attachment must not upload again');
  const restored = join(directory, 'restored');
  await run('restore', restored, config, first.snapshot);
  assert.deepEqual(await readFile(join(restored, 'objects', `${hash(key)}.blob`)), blob);
  assert.equal(await readFile(join(restored, '.env.runtime'), 'utf8'), 'TEST_SECRET=preserved\n');
  const restoredDb = new DatabaseSync(join(restored, 'pdv.sqlite'), { readOnly: true });
  assert.equal(restoredDb.prepare('SELECT length(value) AS size FROM test_payload').get().size, 20 * 1024 * 1024);
  restoredDb.close();
  await assert.rejects(run('restore', restored, config, first.snapshot), /Refusing to overwrite/);
  files.get(`snapshots/${first.snapshot}`)[30] ^= 1;
  await assert.rejects(run('restore', join(directory, 'tampered'), config, first.snapshot), /integrity mismatch/);
  console.log('PASS: multipart encrypted backup, restore, attachment deduplication, overwrite and tamper protection');
} finally { server.close(); }
