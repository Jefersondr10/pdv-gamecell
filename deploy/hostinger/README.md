# AtacadoApple on Hostinger

The default build remains Sites. `npm run build:vps` produces an independent
Node 24.16 standalone release. The database is SQLite WAL with FULL synchronous
durability. Photos are streamed from private persistent storage, not embedded
in database responses or the image. Run one app process per data directory.

## Release and cutover safety

1. Build `deploy/hostinger/Dockerfile`. Never include `.dev.vars`, `.env*`,
   exports, database files or private keys in the image.
2. Export with the encrypted, expiring operational token. `export` and
   `import-candidate` are for isolated rehearsal only, not authoritative data.
3. Rehearse restore and integration in a candidate directory/container. Never
   run the integration script against the live shop.
4. Set `MIGRATION_READ_ONLY=1` in the old Sites environment and deploy. Verify
   every normal API is blocked, including Google callbacks, and wait for
   in-flight writes to complete.
5. Run `export-final`, then `import` into a NEW empty directory. Both require a
   frozen manifest. Check table counts, foreign keys, integrity, commercial
   totals, stock and every attachment hash. Keep source data and export.
6. Pre-create the runtime data directory and chown only that directory to
   `1000:1000`. Container is non-root/read-only; data must remain writable.
   Keep `.env.runtime` separately, root-readable, outside public web files.
7. Add the Caddy routes from `pdv.Caddyfile`, substituting the proxy token
   privately. Verify anonymous origin requests are 403, accepted proxy calls
   use the canonical public HTTPS host, and public callers cannot spoof IP.
   Public domain must use DNS-only A record for the `{remote_host}` IP policy.
   Changing this to a CDN requires explicit trusted proxy configuration.
8. Start the verified live data volume. Switch old Sites
   `MIGRATION_TARGET_ORIGIN=https://srv1939926.hstgr.cloud` and its dedicated
   `MIGRATION_PROXY_TOKEN`; deploy. The old Worker must never fall back to D1.
9. Change the public DNS only after the proxy path passes authentication and
   mutation tests. Both old and new DNS destinations then use the same SQLite.
10. Disable/remove export token and expiry after final checks. Preserve encrypted
    exports off the VPS. Scheduled backups need a separate restore rehearsal;
    the provider's weekly snapshot alone is not an application backup policy.

Rollback after cutover means changing the application release while keeping the
current VPS data. Returning to the frozen D1 loses post-cutover transactions.
Never run the historical production-reset migration against imported data.
Future schema changes need an append-only Node migration runner and backup.

## Gateway safety

The shared gateway also serves unrelated applications. Save its compose/config
and their checksums. Abort an update if the source checksum changed. Validate
the complete candidate config, persist only the PDV route addition, then use
Caddy's graceful reload. Do not recreate or restart the gateway containers.
Keep the gateway's prior config for reversal; do not remove existing domains.

## Independent backups

`atacadoapple-backup.timer` runs hourly. Its service takes an online SQLite
snapshot, verifies it, encrypts database, runtime secrets and all referenced
files with AES-256-GCM, and sends them to the old Sites private object store.
The VPS upload credential cannot delete or replace earlier backups. Unchanged
photos are not uploaded repeatedly. Local timestamped snapshots are retained
for 48 hours; off-site snapshots currently have no automatic deletion policy.
Review off-site storage growth monthly. Keep backup-config.json in a separate
secure location: loss of its encryption key makes recovery impossible.

Before cutover and after material backup changes, restore to a fresh directory
and verify database integrity, foreign keys and every attachment hash. Check
the systemd service and data/backups/last-success.json regularly. The hourly
schedule targets at most one hour of lost work, but failures must be acted on;
it is not a guarantee of zero data loss or automatic failover.
