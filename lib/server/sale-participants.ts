import { can, resolvePermissions } from '../permissions.ts';
import {
  HttpError,
  integerField,
  operationIdField,
  stringField,
} from './http.ts';
import type { AppRole } from '../pdv-types.ts';
import type {
  SaleParticipants,
  SaleParticipantsResponse,
} from '../sale-participants.ts';

const ACTION = 'sale.participants_changed';
type Scope = { storeId: string; actorId: string; saleId: string };
type Seller = {
  id: string;
  name: string;
  role: AppRole;
  permissionsJson: string | null;
  active: number;
};
const canSell = (seller: Seller) =>
  Boolean(seller.active) &&
  can(
    {
      role: seller.role,
      permissions: resolvePermissions(seller.role, seller.permissionsJson),
    },
    'sell',
  );

export async function readSaleParticipants(
  db: D1Database,
  storeId: string,
  saleId: string,
): Promise<SaleParticipants> {
  const current = await db
    .prepare(`SELECT customer_id AS customerId, customer_name AS customerName,
    seller_user_id AS sellerUserId, seller_name AS sellerName, status,
    (SELECT COUNT(*) FROM audit_events a WHERE a.store_id = sales.store_id AND a.entity_id = sales.id AND a.action = ?) AS revision
    FROM sales WHERE id = ? AND store_id = ?`)
    .bind(ACTION, saleId, storeId)
    .first<SaleParticipants>();
  if (!current)
    throw new HttpError(404, 'Venda não encontrada.', 'SALE_NOT_FOUND');
  return { ...current, revision: Number(current.revision) };
}

export async function saleParticipantChoices(
  db: D1Database,
  storeId: string,
  saleId: string,
): Promise<SaleParticipantsResponse> {
  const current = await readSaleParticipants(db, storeId, saleId);
  const results = await Promise.all([
    db
      .prepare(
        'SELECT id, name FROM clients WHERE store_id = ? AND active = 1 ORDER BY name COLLATE NOCASE, id',
      )
      .bind(storeId)
      .all(),
    db
      .prepare(
        'SELECT id, display_name AS name, role, permissions_json AS permissionsJson, active FROM users WHERE store_id = ? AND active = 1 ORDER BY display_name COLLATE NOCASE, id',
      )
      .bind(storeId)
      .all(),
  ]);
  return {
    current,
    clients: results[0].results as Array<{ id: string; name: string }>,
    sellers: (results[1].results as Seller[])
      .filter(canSell)
      .map(({ id, name }) => ({ id, name })),
  };
}

export async function changeSaleParticipants(
  db: D1Database,
  scope: Scope,
  body: Record<string, unknown>,
  consumeBudget?: () => Promise<void>,
) {
  const { storeId, actorId, saleId } = scope;
  if (
    Object.keys(body).some(
      (key) =>
        !['operationId', 'expected', 'customerId', 'sellerUserId'].includes(
          key,
        ),
    )
  )
    throw new HttpError(
      400,
      'A alteração contém um campo não reconhecido.',
      'UNKNOWN_FIELD',
    );
  if (typeof body.operationId !== 'string')
    throw new HttpError(
      400,
      'Identificador da alteração obrigatório.',
      'INVALID_OPERATION_ID',
    );
  const operationId = operationIdField(body.operationId);
  const rawExpected = body.expected;
  if (
    !rawExpected ||
    typeof rawExpected !== 'object' ||
    Array.isArray(rawExpected) ||
    Object.keys(rawExpected).some(
      (key) => !['customerId', 'sellerUserId', 'revision'].includes(key),
    )
  )
    throw new HttpError(
      400,
      'Reabra a venda antes de alterar cliente ou vendedor.',
      'INVALID_EXPECTED',
    );
  const raw = rawExpected as Record<string, unknown>;
  const expected = {
    customerId:
      raw.customerId === null
        ? null
        : stringField(raw.customerId, 'Cliente anterior', { max: 80 }),
    sellerUserId: stringField(raw.sellerUserId, 'Vendedor anterior', {
      max: 80,
    }),
    revision: integerField(raw.revision, 'Versão da venda', {
      min: 0,
      max: 1_000_000,
    }),
  };
  const customerId =
    body.customerId === null
      ? null
      : stringField(body.customerId, 'Cliente', { max: 80 });
  const sellerUserId = stringField(body.sellerUserId, 'Vendedor', { max: 80 });
  const input = { expected, customerId, sellerUserId };
  const readReplay = async () => {
    const event = await db
      .prepare(
        'SELECT store_id AS storeId, actor_user_id AS actorId, entity_id AS saleId, action, details_json AS details FROM audit_events WHERE id = ?',
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
    let eventInput: unknown;
    try {
      eventInput = JSON.parse(event.details).input;
    } catch {
      /* Invalid audits cannot be replayed. */
    }
    if (
      event.storeId !== storeId ||
      event.actorId !== actorId ||
      event.saleId !== saleId ||
      event.action !== ACTION ||
      JSON.stringify(eventInput) !== JSON.stringify(input)
    )
      throw new HttpError(
        409,
        'Esta operação já foi usada. Reabra a venda para fazer outra alteração.',
        'OPERATION_ALREADY_USED',
      );
    return true;
  };
  if (await readReplay())
    return {
      ok: true,
      replayed: true,
      current: await readSaleParticipants(db, storeId, saleId),
    };
  await consumeBudget?.();
  const before = await readSaleParticipants(db, storeId, saleId);
  if (before.status !== 'completed')
    throw new HttpError(
      409,
      'Uma venda cancelada não pode ter cliente ou vendedor alterado.',
      'SALE_CANCELLED',
    );
  if (
    before.customerId !== expected.customerId ||
    before.sellerUserId !== expected.sellerUserId ||
    before.revision !== expected.revision
  )
    throw new HttpError(
      409,
      'O cliente ou vendedor foi alterado por outra pessoa. Reabra a venda e confira antes de salvar.',
      'SALE_CHANGED',
    );
  const client =
    customerId === before.customerId
      ? null
      : await db
          .prepare(
            'SELECT name FROM clients WHERE id = ? AND store_id = ? AND active = 1',
          )
          .bind(customerId, storeId)
          .first<{ name: string }>();
  if (customerId !== before.customerId && !client)
    throw new HttpError(
      409,
      'Selecione um cliente ativo desta loja.',
      'CUSTOMER_INVALID',
    );
  const seller =
    sellerUserId === before.sellerUserId
      ? null
      : await db
          .prepare(
            'SELECT id, display_name AS name, role, permissions_json AS permissionsJson, active FROM users WHERE id = ? AND store_id = ?',
          )
          .bind(sellerUserId, storeId)
          .first<Seller>();
  if (sellerUserId !== before.sellerUserId && (!seller || !canSell(seller)))
    throw new HttpError(
      409,
      'Selecione um vendedor ativo com acesso a vendas nesta loja.',
      'SELLER_INVALID',
    );
  const after = {
    customerId,
    customerName: client?.name ?? before.customerName,
    sellerUserId,
    sellerName: seller?.name ?? before.sellerName,
  };
  const details = JSON.stringify({ input, before, after });
  try {
    // The audit guard and both participant changes commit atomically. A stale form,
    // cancellation or deactivation aborts the entire batch, including the audit.
    await db.batch([
      db
        .prepare(`INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
        SELECT ?, ?, ?, ?, 'sale', CASE WHEN
          EXISTS (SELECT 1 FROM sales WHERE id = ? AND store_id = ? AND status = 'completed' AND customer_id IS ? AND seller_user_id = ?)
          AND (SELECT COUNT(*) FROM audit_events WHERE store_id = ? AND entity_id = ? AND action = ?) = ?
          AND (? IS ? OR EXISTS (SELECT 1 FROM clients WHERE id = ? AND store_id = ? AND active = 1 AND name = ?))
          AND (? = ? OR EXISTS (SELECT 1 FROM users WHERE id = ? AND store_id = ? AND active = 1 AND display_name = ? AND role = ? AND permissions_json IS ?))
        THEN ? ELSE NULL END, ?, ?`)
        .bind(
          operationId,
          storeId,
          actorId,
          ACTION,
          saleId,
          storeId,
          expected.customerId,
          expected.sellerUserId,
          storeId,
          saleId,
          ACTION,
          expected.revision,
          customerId,
          before.customerId,
          customerId,
          storeId,
          after.customerName,
          sellerUserId,
          before.sellerUserId,
          sellerUserId,
          storeId,
          after.sellerName,
          seller?.role ?? '',
          seller?.permissionsJson ?? null,
          saleId,
          details,
          Date.now(),
        ),
      db
        .prepare(
          'UPDATE sales SET customer_id = ?, customer_name = ?, seller_user_id = ?, seller_name = ? WHERE id = ? AND store_id = ?',
        )
        .bind(
          after.customerId,
          after.customerName,
          after.sellerUserId,
          after.sellerName,
          saleId,
          storeId,
        ),
    ]);
  } catch (error) {
    if (await readReplay())
      return {
        ok: true,
        replayed: true,
        current: await readSaleParticipants(db, storeId, saleId),
      };
    if (error instanceof Error && /constraint failed/i.test(error.message))
      throw new HttpError(
        409,
        'A venda ou um cadastro mudou durante o envio. Reabra a venda para conferir.',
        'SALE_CHANGED',
      );
    throw error;
  }
  return {
    ok: true,
    replayed: false,
    current: await readSaleParticipants(db, storeId, saleId),
  };
}
