import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  RECORD_VPS_BACKUP_HEALTH_SQL,
  validBackupHealthTime,
  VPS_BACKUP_HEALTH_MARKER,
} from '../lib/server/backup-health.ts';

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE login_attempts (
  key_hash TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER DEFAULT 0 NOT NULL,
  blocked_until INTEGER,
  updated_at INTEGER NOT NULL
)`);
const record = db.prepare(RECORD_VPS_BACKUP_HEALTH_SQL);
record.run(VPS_BACKUP_HEALTH_MARKER, 2_000);
record.run(VPS_BACKUP_HEALTH_MARKER, 1_000);
assert.equal(
  (
    db
      .prepare('SELECT updated_at AS acceptedAt FROM login_attempts')
      .get() as { acceptedAt: number }
  ).acceptedAt,
  2_000,
  'an older replay must not make a newer backup look stale',
);
record.run(VPS_BACKUP_HEALTH_MARKER, 3_000);
assert.equal(
  (
    db
      .prepare('SELECT updated_at AS acceptedAt FROM login_attempts')
      .get() as { acceptedAt: number }
  ).acceptedAt,
  3_000,
);
assert.equal(validBackupHealthTime(null, 5_000), null);
assert.equal(validBackupHealthTime(65_001, 5_000), null);
assert.equal(validBackupHealthTime(65_000, 5_000), 65_000);
db.close();

console.log('Backup health passed: monotonic snapshot heartbeat under replay.');
