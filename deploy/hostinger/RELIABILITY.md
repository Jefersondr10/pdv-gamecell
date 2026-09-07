# Reliability release, September 2026

## Guarantees and limits

- Sale/entry drafts, including Files, are stored in IndexedDB scoped by store and user. Before sending, an immutable operation envelope is durably saved. Its UUID is both the idempotency identity and the server record ID. A retry first queries the authenticated operation endpoint. A lost response is not displayed as success until server confirmation.
- A persistent cross-tab lease prevents duplicate upload work. SQL transactions and immutable operation IDs provide final protection. Conflicting drafts are blocked rather than silently overwritten. Storage failure before transmission blocks sending.
- This is interruption recovery, not full offline inventory. Resume on reopening the same browser/profile and signing into the same shop/user. Clearing browser data, uninstalling, device loss, or unfinished local writes can lose unsent work. Photos must finish uploading before the server can read them.
- Receipt processing is a durable SQLite job queue. The server works after the browser closes. OCR has its own internal-only, resource-limited container, no production data volume, no credentials and no Internet network. Manual corrections and cancellation take priority through generation/lease comparisons.
- OCR compares document amounts; it never proves that a bank transfer actually settled. Unreadable files or exhausted retries require explicit review. HEIF containers with multiple images deliberately require manual review.

## Release procedure

1. Pass the recovery, queue, migration, backup, baseline and integration tests on synthetic data. Test both PDF and image through the real engine. Build immutable application and OCR images from the same reviewed source revision.
2. Run the application candidate with a separate synthetic database and private OCR network. Require both health checks, authentication, operation lookup, receipt upload and persisted completion. Do not run data-creating integration tests against the public site.
3. Execute `scripts/hostinger/deploy-reliability.sh TAG EXPECTED_OLD_TAG /opt/atacadoapple/release-TAG`. It checks the exact live image/mount, confirms a fresh off-site backup, saves rollback configuration, runs only additive migration 0009 (with an online pre-migration database copy), starts/checks OCR, then switches/checks the app. Never reuse the old ranking-only deployment script.
4. Migration is not auto-applied on app startup. The health endpoint requires the new table. Do not replay migrations 0000–0008 against production: some are historical seeds/reset gates. The dedicated runner validates schema/checksum and preserves business data. Repeated migration invocations create additional pre-migration copies; keep them until release verification, then use an explicitly scoped retention procedure.
5. Publish the same revision to the existing Sites project with migration read-only/proxy settings unchanged. Sites remains the encrypted off-site backup destination, not a second writable inventory database.
6. Run another encrypted backup and verify accepted remote health. Confirm recovery clients and server OCR without changing real sales. Retain previous image/configuration; an application rollback retains the additive schema and all current business records.

## Backup monitoring

The owner/admin UI reports unknown, healthy, warning after 90 minutes, late after 150 minutes, or last-attempt failure. It exposes no encryption keys, backup identifiers or private file paths. A successful status means remote upload completed, not that each backup has been restore-tested.

Sites maintains a receipt timestamp only after accepting a new encrypted snapshot. `GET /api/system/vps-backup?health=1` uses a separate `VPS_BACKUP_MONITOR_TOKEN` and returns only healthy/unhealthy. This monitor credential cannot list or download backups. Replaying an old snapshot cannot refresh the timestamp.

**External notification delivery is not active yet.** It requires the owner's actual destination and an external monitor configured outside the VPS (so total VPS downtime also alerts). Do not label alerts active merely because the protected endpoint exists. Monitor every 5 minutes, notify after two consecutive failures and on recovery; test stale backup, endpoint failure and delivery before activation. Keep encryption recovery keys separately from the VPS and periodically restore to an isolated directory.
