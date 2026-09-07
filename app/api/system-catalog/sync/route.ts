import { assertCsrf, requireSession } from '@/lib/server/auth';
import { apiError, assertSameOrigin, HttpError, json } from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import { syncSystemCatalog } from '@/lib/server/system-catalog-sync';
import { SYSTEM_CATALOG_VERSION } from '@/lib/system-catalog';

const CATALOG_LEASE_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    assertCsrf(request, session);
    const db = runtime().DB;
    const storeId = session.storeId!;
    const now = Date.now();
    const current = await db
      .prepare(
        `SELECT catalog_version AS catalogVersion, synced_at AS syncedAt
         FROM system_catalog_syncs WHERE store_id = ? LIMIT 1`,
      )
      .bind(storeId)
      .first<{ catalogVersion: number; syncedAt: number }>();
    if ((current?.catalogVersion ?? 0) >= SYSTEM_CATALOG_VERSION) {
      return json({
        ok: true,
        version: SYSTEM_CATALOG_VERSION,
        productsAdded: 0,
        codesAdded: 0,
        codesUpdated: 0,
        conflictsSkipped: 0,
        alreadyCurrent: true,
      });
    }
    if (
      (current?.catalogVersion ?? 0) < 0 &&
      Number(current?.syncedAt ?? 0) > now - CATALOG_LEASE_MS
    ) {
      throw new HttpError(
        409,
        'O catálogo padrão já está sendo atualizado nesta loja.',
        'CATALOG_SYNC_IN_PROGRESS',
      );
    }

    const leaseVersion = -SYSTEM_CATALOG_VERSION;
    const claimed = current
      ? await db
          .prepare(
            `UPDATE system_catalog_syncs
             SET catalog_version = ?, synced_at = ?
             WHERE store_id = ? AND catalog_version = ?
             RETURNING store_id AS storeId`,
          )
          .bind(leaseVersion, now, storeId, current.catalogVersion)
          .first<{ storeId: string }>()
      : await db
          .prepare(
            `INSERT INTO system_catalog_syncs
             (store_id, catalog_version, synced_at)
             VALUES (?, ?, ?)
             ON CONFLICT(store_id) DO NOTHING
             RETURNING store_id AS storeId`,
          )
          .bind(storeId, leaseVersion, now)
          .first<{ storeId: string }>();
    if (!claimed) {
      throw new HttpError(
        409,
        'O catálogo padrão já está sendo atualizado nesta loja.',
        'CATALOG_SYNC_IN_PROGRESS',
      );
    }

    try {
      const result = await syncSystemCatalog(db, storeId, session.id);
      return json({ ok: true, ...result });
    } catch (error) {
      await db
        .prepare(
          `UPDATE system_catalog_syncs
           SET catalog_version = ?, synced_at = ?
           WHERE store_id = ? AND catalog_version = ?`,
        )
        .bind(
          Math.max(0, current?.catalogVersion ?? 0),
          Date.now(),
          storeId,
          leaseVersion,
        )
        .run()
        .catch(() => {});
      throw error;
    }
  } catch (error) {
    return apiError(error);
  }
}
