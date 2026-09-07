import assert from 'node:assert/strict';
import { backupStatus } from '../lib/backup-status.ts';
const now = 1_800_000_000_000;
assert.equal(backupStatus(now, false, now).state, 'healthy');
assert.equal(backupStatus(now - 90 * 60_000 + 1, false, now).state, 'healthy');
assert.equal(backupStatus(now - 90 * 60_000, false, now).state, 'warning');
assert.equal(backupStatus(now - 90 * 60_000 - 1, false, now).state, 'warning');
assert.equal(backupStatus(now - 150 * 60_000 + 1, false, now).state, 'warning');
assert.equal(backupStatus(now - 150 * 60_000, false, now).state, 'late');
assert.equal(backupStatus(now - 150 * 60_000 - 1, false, now).state, 'late');
assert.equal(backupStatus(now, true, now).state, 'failed');
for (const invalid of [
  undefined,
  null,
  'today',
  NaN,
  Infinity,
  -1,
  now + 60_001,
]) {
  assert.equal(backupStatus(invalid, false, now).state, 'unknown');
}
assert.equal(backupStatus(now, false, now).externalAlerts, false);
console.log('Backup freshness and unavailable-alert status passed.');
