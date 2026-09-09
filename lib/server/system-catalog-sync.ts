import { classifyCommercialCode, normalizeCommercialCode } from '@/lib/gtin';
import {
  SYSTEM_CATALOG_PRODUCTS,
  SYSTEM_CATALOG_VERSION,
} from '@/lib/system-catalog';

type ProductRow = {
  id: string;
  model: string;
  color: string;
  memory: string;
};

type CodeRow = {
  productId: string;
  code: string;
  market: string | null;
};

export type SystemCatalogSyncResult = {
  version: number;
  productsAdded: number;
  codesAdded: number;
  codesUpdated: number;
  conflictsSkipped: number;
};

export async function syncSystemCatalog(
  db: D1Database,
  storeId: string,
  actorUserId: string,
): Promise<SystemCatalogSyncResult> {
  const now = Date.now();
  const [productResult, codeResult] = await db.batch([
    db
      .prepare(
        `SELECT id, model, color, memory
         FROM products WHERE store_id = ?`,
      )
      .bind(storeId),
    db
      .prepare(
        `SELECT product_id AS productId, code, market
         FROM product_codes WHERE store_id = ?`,
      )
      .bind(storeId),
  ]);
  const products = (productResult.results ?? []) as ProductRow[];
  const codes = (codeResult.results ?? []) as CodeRow[];
  const productByVariation = new Map(
    products.map((product) => [
      canonicalProductVariationKey(product),
      product.id,
    ]),
  );
  const productByCode = new Map(
    codes.map((code) => [code.code, code.productId]),
  );
  const marketByCode = new Map(codes.map((code) => [code.code, code.market]));
  const statements: D1PreparedStatement[] = [];
  let productsAdded = 0;
  let codesAdded = 0;
  let codesUpdated = 0;
  let conflictsSkipped = 0;

  for (const catalogProduct of SYSTEM_CATALOG_PRODUCTS) {
    const normalizedCodes = catalogProduct.codes.map((source) => ({
      source,
      normalized: normalizeCommercialCode(source.value),
    }));
    if (normalizedCodes.some(({ normalized }) => !normalized)) {
      throw new Error(
        `Código inválido no catálogo padrão: ${catalogProduct.key}`,
      );
    }

    const codeMatches = new Set(
      normalizedCodes
        .map(({ normalized }) => productByCode.get(normalized))
        .filter((value): value is string => Boolean(value)),
    );
    const variationMatch = productByVariation.get(
      canonicalProductVariationKey(catalogProduct),
    );
    const productId =
      variationMatch ??
      codeMatches.values().next().value ??
      (await deterministicId(`product:${storeId}:${catalogProduct.key}`));

    if (codeMatches.size > 1) conflictsSkipped += codeMatches.size - 1;

    if (!products.some((product) => product.id === productId)) {
      if (products.length >= 1_000) {
        throw new Error(
          'A loja não possui espaço para receber todo o catálogo padrão.',
        );
      }
      statements.push(
        db
          .prepare(
            `INSERT INTO products
             (id, store_id, model, color, memory, default_price_cents,
              active, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?)
             ON CONFLICT(store_id, model, color, memory) DO NOTHING`,
          )
          .bind(
            productId,
            storeId,
            catalogProduct.model,
            catalogProduct.color,
            catalogProduct.memory,
            actorUserId,
            now,
            now,
          ),
      );
      products.push({
        id: productId,
        model: catalogProduct.model,
        color: catalogProduct.color,
        memory: catalogProduct.memory,
      });
      productByVariation.set(
        canonicalProductVariationKey(catalogProduct),
        productId,
      );
      productsAdded += 1;
    }

    for (const { source, normalized } of normalizedCodes) {
      const existingProductId = productByCode.get(normalized);
      if (existingProductId && existingProductId !== productId) {
        conflictsSkipped += 1;
        continue;
      }
      if (existingProductId) {
        if (!marketByCode.get(normalized)) {
          statements.push(
            db
              .prepare(
                `UPDATE product_codes SET market = ?
                 WHERE store_id = ? AND product_id = ? AND code = ?
                   AND market IS NULL`,
              )
              .bind(source.market, storeId, productId, normalized),
          );
          marketByCode.set(normalized, source.market);
          codesUpdated += 1;
        }
        continue;
      }
      const kind = classifyCommercialCode(source.value, normalized);
      statements.push(
        db
          .prepare(
            `INSERT INTO product_codes
             (id, store_id, product_id, code, kind, market, created_at)
             SELECT ?, ?, p.id, ?, ?, ?, ?
             FROM products p
             WHERE p.id = ? AND p.store_id = ?
             ON CONFLICT(store_id, code) DO NOTHING`,
          )
          .bind(
            await deterministicId(`code:${storeId}:${normalized}`),
            storeId,
            normalized,
            kind,
            source.market,
            now,
            productId,
            storeId,
          ),
      );
      productByCode.set(normalized, productId);
      marketByCode.set(normalized, source.market);
      codesAdded += 1;
    }
  }

  // Automatic statuses are built in, not editable order_statuses rows.
  // Keep every existing custom follow-up and its sale associations.

  for (const batch of chunk(statements, 40)) await db.batch(batch);

  await db.batch([
    db
      .prepare(
        `INSERT INTO system_catalog_syncs (store_id, catalog_version, synced_at)
         VALUES (?, ?, ?)
         ON CONFLICT(store_id) DO UPDATE SET
           catalog_version = excluded.catalog_version,
           synced_at = excluded.synced_at`,
      )
      .bind(storeId, SYSTEM_CATALOG_VERSION, now),
    db
      .prepare(
        `INSERT INTO audit_events
         (id, store_id, actor_user_id, action, entity_type, entity_id,
          details_json, created_at)
         VALUES (?, ?, ?, 'system_catalog.synced', 'store', ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        storeId,
        actorUserId,
        storeId,
        JSON.stringify({
          version: SYSTEM_CATALOG_VERSION,
          productsAdded,
          codesAdded,
          codesUpdated,
          conflictsSkipped,
        }),
        now,
      ),
  ]);

  return {
    version: SYSTEM_CATALOG_VERSION,
    productsAdded,
    codesAdded,
    codesUpdated,
    conflictsSkipped,
  };
}

export function canonicalProductVariationKey(value: {
  model: string;
  color: string;
  memory: string;
}) {
  return [
    normalizeLabel(value.model),
    normalizeLabel(canonicalColor(value.color)),
    normalizeLabel(value.memory).replace(/\s+/g, ''),
  ].join('|');
}

function canonicalColor(value: string) {
  const normalized = normalizeLabel(value);
  const aliases: Record<string, string> = {
    silver: 'prateado',
    prata: 'prateado',
    'cosmic orange': 'laranja cosmico',
    laranja: 'laranja cosmico',
    'deep blue': 'azul intenso',
    lavender: 'lavanda',
    sage: 'salvia',
    white: 'branco',
    black: 'preto',
    blue: 'azul',
    green: 'verde',
    yellow: 'amarelo',
    pink: 'rosa',
    teal: 'verde azulado',
    'verde acinzentado': 'verde azulado',
    ultramarine: 'ultramarino',
    'azul ultramarino': 'ultramarino',
    'soft pink': 'rosa palido',
    'pale pink': 'rosa palido',
    'sky blue': 'azul ceu',
    'cloud white': 'branco nuvem',
    'space black': 'preto espacial',
    'light gold': 'dourado claro',
  };
  return aliases[normalized] ?? normalized;
}

function normalizeLabel(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function deterministicId(seed: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)),
  );
  const hex = Array.from(digest.slice(0, 16), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function chunk<T>(values: T[], size: number) {
  const groups: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    groups.push(values.slice(start, start + size));
  }
  return groups;
}
