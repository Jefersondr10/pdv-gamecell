import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  apiError,
  assertJsonRequest,
  assertSameOrigin,
  boundedJson,
  HttpError,
  integerField,
  json,
  stringField,
} from '@/lib/server/http';
import { consumeStoreWriteBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import { canonicalProductVariationKey } from '@/lib/server/system-catalog-sync';
import { classifyCommercialCode, normalizeCommercialCode } from '@/lib/gtin';
import {
  catalogChanged,
  catalogEditGuard,
  PRODUCT_EDIT_COLUMNS,
} from '@/lib/server/catalog-concurrency';

type SavedProductCode = {
  id: string;
  code: string;
  kind: string;
  market: string | null;
  productId: string;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const session = await requireSession(request, {
      roles: ['owner', 'admin'],
    });
    assertCsrf(request, session);
    const { id } = await context.params;
    const body = (await boundedJson(request)) as Record<string, unknown>;
    const db = runtime().DB;
    const now = Date.now();
    await consumeStoreWriteBudget(db, now, session.storeId!, 3);
    const exists = await db
      .prepare(
        `SELECT model, color, memory FROM products
         WHERE id = ? AND store_id = ? LIMIT 1`,
      )
      .bind(id, session.storeId)
      .first<{ model: string; color: string; memory: string }>();
    if (!exists) {
      throw new HttpError(404, 'Produto não encontrado.', 'NOT_FOUND');
    }

    const updates: string[] = [];
    const bindings: unknown[] = [];
    const changed: Record<string, unknown> = {};
    let addedCode: {
      id: string;
      code: string;
      kind: string;
      market: string | null;
    } | null = null;
    if (body.addCode !== undefined) {
      if (
        !body.addCode ||
        typeof body.addCode !== 'object' ||
        Array.isArray(body.addCode)
      ) {
        throw new HttpError(
          400,
          'Informe o código do produto.',
          'INVALID_CODE',
        );
      }
      const input = body.addCode as Record<string, unknown>;
      const raw = stringField(input.code, 'Código', { min: 8, max: 30 });
      const code = normalizeCommercialCode(raw);
      if (!code)
        throw new HttpError(
          400,
          'UPC, EAN ou JAN inválido. Confira todos os números.',
          'INVALID_CODE',
        );
      // Insert-or-ignore plus the guarded update below also handles simultaneous
      // retries. A code belonging to another variation can never be moved here.
      addedCode = {
        id: crypto.randomUUID(),
        code,
        kind: classifyCommercialCode(raw, code),
        market: input.market
          ? stringField(input.market, 'Mercado', { max: 60 })
          : null,
      };
      changed.code = { code };
    }
    if (body.model !== undefined) {
      const value = stringField(body.model, 'Modelo', { max: 100 });
      updates.push('model = ?');
      bindings.push(value);
      changed.model = value;
    }
    if (body.color !== undefined) {
      const value = stringField(body.color, 'Cor', { max: 80 });
      updates.push('color = ?');
      bindings.push(value);
      changed.color = value;
    }
    if (body.memory !== undefined) {
      const value = stringField(body.memory, 'Memória', { max: 60 });
      updates.push('memory = ?');
      bindings.push(value);
      changed.memory = value;
    }
    if (body.defaultPriceCents !== undefined) {
      const value = integerField(body.defaultPriceCents, 'Preço', {
        min: 0,
        max: 1_000_000_000,
      });
      updates.push('default_price_cents = ?');
      bindings.push(value);
      changed.defaultPriceCents = value;
    }
    if (typeof body.active === 'boolean') {
      updates.push('active = ?');
      bindings.push(body.active ? 1 : 0);
      changed.active = body.active;
    }
    if (updates.length === 0 && body.addCode === undefined) {
      throw new HttpError(
        400,
        'Nenhuma alteração foi informada.',
        'NO_CHANGES',
      );
    }
    if (
      changed.model !== undefined ||
      changed.color !== undefined ||
      changed.memory !== undefined
    ) {
      const nextVariationKey = canonicalProductVariationKey({
        model: (changed.model as string | undefined) ?? exists.model,
        color: (changed.color as string | undefined) ?? exists.color,
        memory: (changed.memory as string | undefined) ?? exists.memory,
      });
      const otherProducts = (
        await db
          .prepare(
            `SELECT model, color, memory FROM products
             WHERE store_id = ? AND id <> ? LIMIT 1000`,
          )
          .bind(session.storeId, id)
          .all<{ model: string; color: string; memory: string }>()
      ).results;
      if (
        otherProducts.some(
          (product) =>
            canonicalProductVariationKey(product) === nextVariationKey,
        )
      ) {
        throw new HttpError(
          409,
          'Já existe um produto com este modelo, cor e memória.',
          'PRODUCT_EXISTS',
        );
      }
    }
    const guard = catalogEditGuard(
      body.expected,
      changed,
      PRODUCT_EDIT_COLUMNS,
      'products',
    );
    const insertGuard = catalogEditGuard(
      body.expected,
      changed,
      PRODUCT_EDIT_COLUMNS,
      'p',
    );
    updates.push('updated_at = ?');
    bindings.push(now, id, session.storeId);
    let savedCode: {
      id: string;
      code: string;
      kind: string;
      market: string | null;
      productId: string;
    } | null = null;
    try {
      const results = await db.batch([
        ...(addedCode
          ? [
              db
                .prepare(
                  `INSERT INTO product_codes (id, store_id, product_id, code, kind, market, created_at)
           SELECT ?, p.store_id, p.id, ?, ?, ?, ? FROM products p
           WHERE p.id = ? AND p.store_id = ? AND
             (SELECT COUNT(*) FROM product_codes pc WHERE pc.product_id = p.id AND pc.store_id = p.store_id) < 20${insertGuard.sql}
           ON CONFLICT(store_id, code) DO NOTHING`,
                )
                .bind(
                  addedCode.id,
                  addedCode.code,
                  addedCode.kind,
                  addedCode.market,
                  now,
                  id,
                  session.storeId,
                  ...insertGuard.bindings,
                ),
            ]
          : []),
        db
          .prepare(
            `UPDATE products SET ${updates.join(', ')}
             WHERE id = ? AND store_id = ?${guard.sql}${addedCode ? ' AND EXISTS (SELECT 1 FROM product_codes WHERE code = ? AND product_id = ? AND store_id = ?)' : ''}`,
          )
          .bind(
            ...bindings,
            ...guard.bindings,
            ...(addedCode ? [addedCode.code, id, session.storeId] : []),
          ),
        db
          .prepare(
            `INSERT INTO audit_events
             (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
             SELECT ?, ?, ?, 'product.updated', 'product', ?, ?, ? WHERE changes() = 1`,
          )
          .bind(
            crypto.randomUUID(),
            session.storeId,
            session.id,
            id,
            JSON.stringify(changed),
            now,
          ),
        ...(addedCode
          ? [
              db
                .prepare(
                  'SELECT id, code, kind, market, product_id AS productId FROM product_codes WHERE store_id = ? AND code = ? LIMIT 1',
                )
                .bind(session.storeId, addedCode.code),
            ]
          : []),
      ]);
      if (
        Number(results[addedCode ? 1 : 0]?.meta?.changes ?? 0) !== 1 &&
        guard.sql
      ) {
        const matches = await db
          .prepare(
            `SELECT id FROM products WHERE id = ? AND store_id = ?${guard.sql}`,
          )
          .bind(id, session.storeId, ...guard.bindings)
          .first();
        if (!matches) throw catalogChanged();
      }
      if (addedCode) {
        savedCode =
          (results[3]?.results?.[0] as SavedProductCode | undefined) ?? null;
        if (Number(results[1]?.meta?.changes ?? 0) !== 1) {
          if (savedCode && savedCode.productId !== id)
            throw new HttpError(
              409,
              'Este código já está vinculado a outro produto. Nenhuma alteração foi salva.',
              'CODE_EXISTS',
            );
          throw new HttpError(
            409,
            'Este produto atingiu o limite de 20 códigos. Nenhuma alteração foi salva.',
            'PRODUCT_CODE_LIMIT',
          );
        }
      }
      if (Number(results[addedCode ? 1 : 0]?.meta?.changes ?? 0) !== 1) {
        throw new HttpError(404, 'Produto não encontrado.', 'NOT_FOUND');
      }
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE constraint failed:.*product_codes\.(?:store_id|code)/i.test(
          error.message,
        )
      ) {
        throw new HttpError(
          409,
          'Este código já foi cadastrado. Confira o produto e tente salvar novamente.',
          'CODE_EXISTS',
        );
      }
      if (
        error instanceof Error &&
        /UNIQUE constraint failed:.*products.*store_id/i.test(error.message)
      ) {
        throw new HttpError(
          409,
          'Já existe um produto com este modelo, cor e memória.',
          'PRODUCT_EXISTS',
        );
      }
      throw error;
    }
    return json({
      ok: true,
      code: savedCode
        ? {
            id: savedCode.id,
            code: savedCode.code,
            kind: savedCode.kind,
            market: savedCode.market,
          }
        : null,
    });
  } catch (error) {
    return apiError(error);
  }
}
