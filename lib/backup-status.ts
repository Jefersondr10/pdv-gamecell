export type BackupStatus = {
  state: 'healthy' | 'warning' | 'late' | 'failed' | 'unknown';
  lastSuccessAt: number | null;
  externalAlerts: boolean;
};
export const BACKUP_WARNING_MS = 90 * 60_000;
export const BACKUP_LATE_MS = 150 * 60_000;
export function backupStatus(
  successAt: unknown,
  failed: boolean,
  now = Date.now(),
): BackupStatus {
  const time =
    typeof successAt === 'number' &&
    Number.isFinite(successAt) &&
    successAt > 0 &&
    successAt <= now + 60_000
      ? successAt
      : null;
  const age = time === null ? null : now - time;
  return {
    state: failed
      ? 'failed'
      : age === null
        ? 'unknown'
        : age >= BACKUP_LATE_MS
          ? 'late'
          : age >= BACKUP_WARNING_MS
            ? 'warning'
            : 'healthy',
    lastSuccessAt: time,
    externalAlerts: false,
  };
}
