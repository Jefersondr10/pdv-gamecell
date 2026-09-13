import { can, type PermissionSubject } from '../permissions.ts';
import {
  HttpError,
  integerField,
  operationIdField,
  stringField,
} from './http.ts';
import type { SalePrices } from '../sale-prices.ts';
import { SALE_RECEIVED_TOTAL_SQL } from './sale-status-sql.ts';

const ACTION = 'sale.prices_changed';
type Scope = {
  storeId: string;
  actorId: string;
  saleId: string;
  subject: PermissionSubject;
};
function authorize(scope: Scope) {
  if (!can(scope.subject, 'sales.prices'))
    throw new HttpError(
      403,
      'Seu usuário não pode alterar os preços de vendas já realizadas.',
      'PERMISSION_DENIED',
    );
}
export async function readSalePrices(
  db: D1Database,
  scope: Scope,
): Promise<SalePrices> {
  authorize(scope);
  const sale = await db
    .prepare(`SELECT status, products_total_cents AS productsTotalCents,
    ${SALE_RECEIVED_TOTAL_SQL} AS receivedTotalCents,
    (${SALE_RECEIVED_TOTAL_SQL} - s.products_total_cents) AS receivedDifferenceCents,
    price_difference_cents AS priceDifferenceCents,
    (SELECT COUNT(*) FROM audit_events e WHERE e.store_id=s.store_id AND e.entity_id=s.id AND e.action=?) AS revision
    FROM sales s WHERE s.id=? AND s.store_id=?`)
    .bind(ACTION, scope.saleId, scope.storeId)
    .first<Omit<SalePrices, 'items'>>();
  if (!sale)
    throw new HttpError(404, 'Venda não encontrada.', 'SALE_NOT_FOUND');
  const items = await db
    .prepare(
      'SELECT id, sold_price_cents AS soldPriceCents FROM sale_items WHERE sale_id=? AND store_id=? ORDER BY id',
    )
    .bind(scope.saleId, scope.storeId)
    .all<SalePrices['items'][number]>();
  return { ...sale, items: items.results };
}

export async function changeSalePrices(
  db: D1Database,
  scope: Scope,
  body: Record<string, unknown>,
) {
  authorize(scope);
  if (
    Object.keys(body).some(
      (key) => !['operationId', 'revision', 'items'].includes(key),
    )
  )
    throw new HttpError(
      400,
      'A alteração contém um campo não reconhecido.',
      'UNKNOWN_FIELD',
    );
  if (body.operationId === undefined)
    throw new HttpError(
      400,
      'Identificador da operação obrigatório.',
      'INVALID_OPERATION_ID',
    );
  const operationId = operationIdField(body.operationId);
  const revision = integerField(body.revision, 'Versão da venda', {
    min: 0,
    max: 1_000_000,
  });
  if (
    !Array.isArray(body.items) ||
    !body.items.length ||
    body.items.length > 50
  )
    throw new HttpError(
      400,
      'Informe os produtos desta venda.',
      'INVALID_ITEMS',
    );
  const items = body.items
    .map((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new HttpError(400, 'Produto inválido.', 'INVALID_ITEMS');
      const row = value as Record<string, unknown>;
      if (
        Object.keys(row).some(
          (key) => !['id', 'expectedPriceCents', 'priceCents'].includes(key),
        )
      )
        throw new HttpError(
          400,
          'Produto com campo não reconhecido.',
          'UNKNOWN_FIELD',
        );
      return {
        id: stringField(row.id, 'Produto da venda', { max: 80 }),
        expectedPriceCents: integerField(
          row.expectedPriceCents,
          'Preço anterior',
          { min: 0, max: 1_000_000_000 },
        ),
        priceCents: integerField(row.priceCents, 'Preço de venda', {
          min: 1,
          max: 1_000_000_000,
        }),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new HttpError(400, 'Não repita o mesmo produto.', 'DUPLICATE_ITEM');
  const fingerprint = JSON.stringify({ revision, items });
  const replay = async () => {
    const event = await db
      .prepare(
        `SELECT store_id AS storeId, actor_user_id AS actorId, entity_id AS saleId, action, details_json AS details FROM audit_events WHERE id=?`,
      )
      .bind(operationId)
      .first<{
        storeId: string;
        actorId: string;
        saleId: string;
        action: string;
        details: string;
      }>();
    if (!event) return false;
    let recordedFingerprint: unknown;
    try {
      recordedFingerprint = JSON.parse(event.details)?.fingerprint;
    } catch {
      recordedFingerprint = null;
    }
    if (
      event.storeId !== scope.storeId ||
      event.actorId !== scope.actorId ||
      event.saleId !== scope.saleId ||
      event.action !== ACTION ||
      recordedFingerprint !== fingerprint
    )
      throw new HttpError(
        409,
        'Este envio já foi usado em outra alteração.',
        'OPERATION_CONFLICT',
      );
    return true;
  };
  if (await replay())
    return { ...(await readSalePrices(db, scope)), replayed: true };
  const current = await readSalePrices(db, scope);
  if (current.status !== 'completed')
    throw new HttpError(
      409,
      'Não é possível alterar preços de uma venda cancelada.',
      'SALE_CANCELLED',
    );
  const conflict = () =>
    new HttpError(
      409,
      'Os preços mudaram em outra tela. Feche esta edição e abra novamente para conferir.',
      'SALE_PRICES_CHANGED',
    );
  if (
    current.revision !== revision ||
    current.items.length !== items.length ||
    current.items.some(
      (item) =>
        !items.some(
          (input) =>
            input.id === item.id &&
            input.expectedPriceCents === item.soldPriceCents,
        ),
    )
  )
    throw conflict();
  if (items.every((item) => item.priceCents === item.expectedPriceCents))
    throw new HttpError(400, 'Nenhum preço foi alterado.', 'NO_CHANGES');
  const now = Date.now();
  const inputJson = JSON.stringify(items);
  const newTotal = items.reduce((sum, item) => sum + item.priceCents, 0);
  try {
    await db.batch([
      // Conditional INSERT is the transaction's lock/checkpoint. All changes
      // depend on its existence, including ABA-safe price revision checks.
      db
        .prepare(`INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
        SELECT ?,s.store_id,?,?,'sale',s.id,
          json_object('fingerprint',?,'before',json_object('revision',?,
            'totalCents',s.products_total_cents,'receivedTotalCents',${SALE_RECEIVED_TOTAL_SQL},
            'receivedDifferenceCents',${SALE_RECEIVED_TOTAL_SQL}-s.products_total_cents,'referenceTotalCents',s.reference_total_cents,
            'priceDifferenceCents',s.price_difference_cents,
            'items',json((SELECT json_group_array(json_object('id',si.id,'serial',si.serial,'soldPriceCents',si.sold_price_cents,'referencePriceCents',si.reference_price_cents)) FROM sale_items si WHERE si.sale_id=s.id AND si.store_id=s.store_id))),
            'after',json_object('totalCents',?,'receivedTotalCents',${SALE_RECEIVED_TOTAL_SQL},
            'receivedDifferenceCents',${SALE_RECEIVED_TOTAL_SQL}-?,'referenceTotalCents',s.reference_total_cents,
            'priceDifferenceCents',(SELECT SUM(CASE WHEN si.reference_price_cents>0 THEN json_extract(j.value,'$.priceCents')-si.reference_price_cents ELSE 0 END) FROM sale_items si JOIN json_each(?) j ON json_extract(j.value,'$.id')=si.id WHERE si.sale_id=s.id AND si.store_id=s.store_id),
            'items',json((SELECT json_group_array(json_object('id',si.id,'serial',si.serial,'soldPriceCents',json_extract(j.value,'$.priceCents'),'referencePriceCents',si.reference_price_cents)) FROM sale_items si JOIN json_each(?) j ON json_extract(j.value,'$.id')=si.id WHERE si.sale_id=s.id AND si.store_id=s.store_id)))),?
        FROM sales s WHERE s.id=? AND s.store_id=? AND s.status='completed'
          AND (SELECT COUNT(*) FROM audit_events e WHERE e.store_id=s.store_id AND e.entity_id=s.id AND e.action=?)=?
          AND (SELECT COUNT(*) FROM sale_items WHERE sale_id=s.id AND store_id=s.store_id)=?
          AND NOT EXISTS (SELECT 1 FROM json_each(?) j LEFT JOIN sale_items si
            ON si.id=json_extract(j.value,'$.id') AND si.sale_id=s.id AND si.store_id=s.store_id
            WHERE si.id IS NULL OR si.sold_price_cents != json_extract(j.value,'$.expectedPriceCents'))`)
        .bind(
          operationId,
          scope.actorId,
          ACTION,
          fingerprint,
          revision,
          newTotal,
          newTotal,
          inputJson,
          inputJson,
          now,
          scope.saleId,
          scope.storeId,
          ACTION,
          revision,
          items.length,
          inputJson,
        ),
      db
        .prepare(`UPDATE sale_items SET sold_price_cents=(SELECT json_extract(j.value,'$.priceCents') FROM json_each(?) j WHERE json_extract(j.value,'$.id')=sale_items.id)
        WHERE sale_id=? AND store_id=? AND EXISTS(SELECT 1 FROM audit_events WHERE id=? AND store_id=?)`)
        .bind(
          inputJson,
          scope.saleId,
          scope.storeId,
          operationId,
          scope.storeId,
        ),
      db
        .prepare(`UPDATE sales AS s SET
        products_total_cents=(SELECT SUM(sold_price_cents) FROM sale_items WHERE sale_id=s.id AND store_id=s.store_id),
        received_total_cents=${SALE_RECEIVED_TOTAL_SQL},
        received_difference_cents=${SALE_RECEIVED_TOTAL_SQL}-(SELECT SUM(sold_price_cents) FROM sale_items WHERE sale_id=s.id AND store_id=s.store_id),
        price_difference_cents=(SELECT COALESCE(SUM(CASE WHEN reference_price_cents>0 THEN sold_price_cents-reference_price_cents ELSE 0 END),0) FROM sale_items WHERE sale_id=s.id AND store_id=s.store_id)
        WHERE s.id=? AND s.store_id=? AND EXISTS(SELECT 1 FROM audit_events WHERE id=? AND store_id=?)`)
        .bind(scope.saleId, scope.storeId, operationId, scope.storeId),
    ]);
  } catch (error) {
    if (await replay())
      return { ...(await readSalePrices(db, scope)), replayed: true };
    throw error;
  }
  if (!(await replay())) throw conflict();
  return { ...(await readSalePrices(db, scope)), replayed: false };
}
