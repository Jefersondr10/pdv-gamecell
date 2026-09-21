// Dependency-free so the standalone Node cleanup worker can load this module.
// Metadata deletion and a durable object-cleanup job are committed together.
// Access expires independently of when cleanup runs.
export async function expireReportFiles(db: D1Database, now = Date.now()) {
  const installed = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='report_shares'",
    )
    .first();
  if (!installed) return;
  const rows = await db
    .prepare(`SELECT r.id, r.attachment_id AS attachmentId, a.r2_key AS key
    FROM report_shares r JOIN attachments a ON a.id=r.attachment_id AND a.store_id=r.store_id
    WHERE (r.expires_at<=? OR r.revoked_at IS NOT NULL) AND a.kind='report' LIMIT 10`)
    .bind(now)
    .all<{ id: string; attachmentId: string; key: string }>();
  for (const row of rows.results)
    await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO file_deletion_jobs (operation_id,r2_key,attempts,next_attempt_at,created_at) VALUES (?,?,0,?,?)`,
        )
        .bind(`report:${row.id}`, row.key, now, now),
      db
        .prepare("DELETE FROM attachments WHERE id=? AND kind='report'")
        .bind(row.attachmentId),
    ]);
}
