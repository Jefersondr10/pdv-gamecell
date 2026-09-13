export const VPS_BACKUP_HEALTH_MARKER = 'system:vps-backup-health';

// MAX is evaluated inside the SQLite UPSERT, so an older replay cannot win a
// read-then-write race against a newer successful snapshot.
export const RECORD_VPS_BACKUP_HEALTH_SQL = `INSERT INTO login_attempts
  (key_hash,attempts,blocked_until,updated_at) VALUES (?,0,NULL,?)
  ON CONFLICT(key_hash) DO UPDATE SET
    attempts=0,
    blocked_until=NULL,
    updated_at=MAX(login_attempts.updated_at,excluded.updated_at)`;

export function validBackupHealthTime(value: unknown, now = Date.now()) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= now + 60_000
    ? value
    : null;
}
