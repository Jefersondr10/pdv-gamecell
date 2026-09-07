import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function readBackupStatus(directory) {
  const load = async (name) => {
    try {
      return JSON.parse(
        await readFile(join(directory, 'backups', name), 'utf8'),
      );
    } catch {
      return null;
    }
  };
  const [success, attempt, failure] = await Promise.all([
    load('last-success.json'),
    load('last-attempt.json'),
    load('last-failure.json'),
  ]);
  const timestamp = (value) =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= Date.now() + 60_000
      ? value
      : null;
  const successAt =
    timestamp(success?.completedAt) ?? timestamp(success?.capturedAt);
  const failureAt = Math.max(
    timestamp(failure?.finishedAt) ?? 0,
    attempt?.state === 'failed' ? (timestamp(attempt.finishedAt) ?? 0) : 0,
  );
  return {
    successAt,
    failed: failureAt > (successAt ?? 0),
  };
}
