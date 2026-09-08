import { requireSession } from '@/lib/server/auth';
import { can, canAny, resolvePermissions } from '@/lib/permissions';
import { apiError, json } from '@/lib/server/http';
import { GUIDE_VERSION } from '@/lib/pdv-types';
import type {
  BootstrapData,
  ClientRecord,
  OrderStatusRecord,
  PixAccountRecord,
  ProductRecord,
  UserRecord,
} from '@/lib/pdv-types';
import { runtime } from '@/lib/server/runtime';
import { consumeStoreReadBudget } from '@/lib/server/rate-limit';
import { SYSTEM_CATALOG_VERSION } from '@/lib/system-catalog';

export const dynamic = 'force-dynamic';

type ProductRow = Omit<ProductRecord, 'detail' | 'active' | 'codes'> & {
  active: number;
};
type CodeRow = {
  id: string;
  productId: string;
  code: string;
  kind: string;
  market: string | null;
};
type ClientRow = Omit<ClientRecord, 'active'> & { active: number };
type PixAccountRow = Omit<PixAccountRecord, 'active'> & { active: number };
type OrderStatusRow = Omit<OrderStatusRecord, 'active'> & { active: number };
type UserRow = Omit<UserRecord, 'active' | 'mustChangePassword'> & {
  active: number;
  mustChangePassword: number;
};

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const storeId = session.storeId!;
    const db = runtime().DB;
    await consumeStoreReadBudget(db, Date.now(), storeId, 20);
    const includeUsers = can(session, 'users.manage');
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const todayStart = new Date(`${today}T00:00:00-03:00`).getTime();
    const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
    const results = await db.batch([
      db
        .prepare(
          `SELECT id, model, color, memory,
                  default_price_cents AS defaultPriceCents, active
           FROM products WHERE store_id = ?
           ORDER BY active DESC, model, color, memory`,
        )
        .bind(storeId),
      db
        .prepare(
          `SELECT id, product_id AS productId, code, kind, market
           FROM product_codes WHERE store_id = ? ORDER BY created_at`,
        )
        .bind(storeId),
      db
        .prepare(
          `SELECT id, name, phone, email, notes, active
           FROM clients WHERE store_id = ? ORDER BY active DESC, name`,
        )
        .bind(storeId),
      db
        .prepare(
          `SELECT id, name, details, active
           FROM pix_accounts WHERE store_id = ? ORDER BY active DESC, name`,
        )
        .bind(storeId),
      db
        .prepare(
          `SELECT id, name, color, active
           FROM order_statuses WHERE store_id = ?
           ORDER BY active DESC, name COLLATE NOCASE`,
        )
        .bind(storeId),
      includeUsers
        ? db
            .prepare(
              `SELECT id, display_name AS displayName,
                      username_normalized AS username, email, role,
                      auth_kind AS authKind, active,
                      permissions_json AS permissionsJson,
                      must_change_password AS mustChangePassword,
                      last_login_at AS lastLoginAt
               FROM users WHERE store_id = ?
               ORDER BY active DESC, display_name`,
            )
            .bind(storeId)
        : db.prepare('SELECT id FROM users WHERE 0'),
      db
        .prepare(
          'SELECT 1 AS acknowledged FROM guide_reads WHERE user_id = ? AND version = ? LIMIT 1',
        )
        .bind(session.id, GUIDE_VERSION),
      db
        .prepare(
          `SELECT COUNT(si.id) AS soldTodayItems
           FROM sales s
           JOIN sale_items si ON si.sale_id = s.id AND si.store_id = s.store_id
           WHERE s.store_id = ? AND s.status = 'completed'
             AND s.created_at >= ? AND s.created_at < ?`,
        )
        .bind(storeId, todayStart, tomorrowStart),
      db
        .prepare(
          `SELECT catalog_version AS catalogVersion
           FROM system_catalog_syncs WHERE store_id = ? LIMIT 1`,
        )
        .bind(storeId),
      db
        .prepare(
          `SELECT id, display_name AS displayName, role, permissions_json AS permissionsJson
           FROM users WHERE store_id = ? AND active = 1
           ORDER BY display_name COLLATE NOCASE, id`,
        )
        .bind(storeId),
    ]);

    const productRows = rows<ProductRow>(results[0]);
    const codeRows = rows<CodeRow>(results[1]);
    const codesByProduct = new Map<
      string,
      Array<{
        id: string;
        code: string;
        kind: string;
        market: string | null;
      }>
    >();
    for (const { productId, id, code, kind, market } of codeRows) {
      const productCodes = codesByProduct.get(productId) ?? [];
      productCodes.push({ id, code, kind, market });
      codesByProduct.set(productId, productCodes);
    }
    const products: ProductRecord[] = productRows.map((product) => ({
      ...product,
      detail: `${product.color} · ${product.memory}`,
      active: Boolean(product.active),
      codes: codesByProduct.get(product.id) ?? [],
    }));
    const clients = rows<ClientRow>(results[2]).map((client) => ({
      ...client,
      active: Boolean(client.active),
    }));
    const pixAccounts = rows<PixAccountRow>(results[3]).map((account) => ({
      ...account,
      active: Boolean(account.active),
    }));
    const orderStatuses = rows<OrderStatusRow>(results[4]).map((status) => ({
      ...status,
      active: Boolean(status.active),
    }));
    const users = rows<UserRow & { permissionsJson: string | null }>(
      results[5],
    ).map(({ permissionsJson, ...user }) => ({
      ...user,
      permissions: resolvePermissions(user.role, permissionsJson),
      active: Boolean(user.active),
      mustChangePassword: Boolean(user.mustChangePassword),
    }));
    const data: BootstrapData = {
      serverReceiptOcr: Boolean(runtime().RECEIPT_OCR_ENGINE_URL),
      csrfToken: session.csrfToken,
      user: {
        id: session.id,
        displayName: session.displayName,
        username: session.username,
        email: session.email,
        role: session.role,
        permissions: session.permissions,
        authKind: session.authKind,
        active: true,
        mustChangePassword: session.mustChangePassword,
        lastLoginAt: null,
        photoUrl: session.photoUrl,
      },
      store: {
        id: storeId,
        name: session.storeName!,
        code: session.storeCode!,
      },
      products: canAny(session, ['products', 'stock', 'entry']) ? products : [],
      clients: can(session, 'clients')
        ? clients
        : can(session, 'sell')
          ? clients
              .filter((client) => client.active)
              .map((client) => ({ ...client, email: null, notes: null }))
          : [],
      pixAccounts: can(session, 'finance')
        ? pixAccounts
        : canAny(session, ['sell', 'sales.payments'])
          ? pixAccounts
              .filter((account) => account.active)
              .map((account) => ({ ...account, details: null }))
          : [],
      orderStatuses: canAny(session, ['finance', 'sales']) ? orderStatuses : [],
      metrics: {
        soldTodayItems: canAny(session, ['sales', 'ranking', 'overview'])
          ? Number(
              rows<{ soldTodayItems: number }>(results[7])[0]?.soldTodayItems ??
                0,
            )
          : 0,
      },
      users,
      sellers: can(session, 'sell')
        ? rows<{
            id: string;
            displayName: string;
            role: UserRecord['role'];
            permissionsJson: string | null;
          }>(results[9])
            .filter(
              (seller) =>
                can(
                  {
                    role: seller.role,
                    permissions: resolvePermissions(
                      seller.role,
                      seller.permissionsJson,
                    ),
                  },
                  'sell',
                ) &&
                (seller.id === session.id || can(session, 'sell.assign')),
            )
            .map(({ id, displayName }) => ({ id, displayName }))
        : [],
      systemCatalog: {
        currentVersion: SYSTEM_CATALOG_VERSION,
        syncedVersion: Number(
          rows<{ catalogVersion: number }>(results[8])[0]?.catalogVersion ?? 0,
        ),
        updateAvailable:
          Number(
            rows<{ catalogVersion: number }>(results[8])[0]?.catalogVersion ??
              0,
          ) < SYSTEM_CATALOG_VERSION,
      },
      guideRequired: rows(results[6]).length === 0,
      guideVersion: GUIDE_VERSION,
    };
    return json(data);
  } catch (error) {
    return apiError(error);
  }
}

function rows<T = Record<string, unknown>>(result: D1Result<unknown>) {
  return (result.results ?? []) as T[];
}
