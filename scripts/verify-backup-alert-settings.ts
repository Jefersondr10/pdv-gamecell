import assert from 'node:assert/strict';
import { normalizeBackupAlertEmail } from '../lib/backup-alert-settings.ts';
assert.equal(
  normalizeBackupAlertEmail(' Owner+Backups@Example.COM '),
  'owner+backups@example.com',
);
assert.equal(normalizeBackupAlertEmail(''), null);
assert.equal(normalizeBackupAlertEmail('   '), null);
for (const value of [
  null,
  {},
  17,
  'x',
  '@example.com',
  'a@@example.com',
  'a@-example.com',
  'a@example..com',
  'a@example.com\nBcc:b@example.com',
  'a@example.com,b@example.com',
  '.a@example.com',
  'a..b@example.com',
  `${'x'.repeat(65)}@example.com`,
])
  assert.throws(() => normalizeBackupAlertEmail(value));
console.log(
  'Backup email validation, normalization and removal checks passed.',
);
