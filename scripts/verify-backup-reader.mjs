import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBackupStatus } from '../lib/server/node/backup-status.mjs';
const directory = await mkdtemp(join(tmpdir(), 'pdv-backup-reader-test-'));
await mkdir(join(directory, 'backups'));
const put = (name, value) =>
  writeFile(join(directory, 'backups', name), JSON.stringify(value));
const now = Date.now() - 1000;
assert.deepEqual(await readBackupStatus(directory), {
  successAt: null,
  failed: false,
});
await put('last-success.json', { capturedAt: now - 1000 });
assert.deepEqual(await readBackupStatus(directory), {
  successAt: now - 1000,
  failed: false,
});
await put('last-failure.json', { finishedAt: now });
await put('last-attempt.json', { state: 'running', startedAt: now + 1 });
assert.equal((await readBackupStatus(directory)).failed, true);
await put('last-success.json', { completedAt: now + 2 });
assert.equal((await readBackupStatus(directory)).failed, false);
await put('last-success.json', { completedAt: 'invalid' });
assert.deepEqual(await readBackupStatus(directory), {
  successAt: null,
  failed: true,
});
await writeFile(join(directory, 'backups', 'last-success.json'), '{broken');
assert.deepEqual(await readBackupStatus(directory), {
  successAt: null,
  failed: true,
});
console.log(
  'Backup status reader: missing, corrupt, legacy, running after failure and recovery passed.',
);
