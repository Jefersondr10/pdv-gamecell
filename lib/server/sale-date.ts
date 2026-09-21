import { HttpError, integerField, operationIdField } from './http.ts';

const ACTION = 'sale.date_changed';
const MINIMUM_SALE_DATE = Date.UTC(2020, 0, 1);
const MAXIMUM_FUTURE_SKEW = 5 * 60 * 1000;

export type SaleDateState = {
  createdAt: number;
  minimumCreatedAt: number;
  revision: number;
  status: 'completed' | 'cancelled';
};

type Scope = {
  actorId: string;
  saleId: string;
  storeId: string;
};

export async function readSaleDate(
  db: D1Database,
  storeId: string,
  saleId: string,
): Promise<SaleDateState> {
  const current = await db
    .prepare(
      `SELECT s.created_at AS createdAt, s.status,
        (SELECT COUNT(*) FROM audit_events a
          WHERE a.store_id=s.store_id AND a.entity_id=s.id AND a.action=?) AS revision,
        COALESCE((SELECT MAX(e.created_at)
          FROM sale_items si
          JOIN inventory_units iu ON iu.id=si.inventory_unit_id AND iu.store_id=si.store_id
          JOIN entries e ON e.id=iu.entry_id AND e.store_id=iu.store_id
          WHERE si.store_id=s.store_id AND si.sale_id=s.id),0) AS minimumCreatedAt
       FROM sales s WHERE s.id=? AND s.store_id=?`,
    )
    .bind(ACTION, saleId, storeId)
    .first<SaleDateState>();
  if (!current)
    throw new HttpError(404, 'Venda não encontrada.', 'SALE_NOT_FOUND');
  return {
    createdAt: Number(current.createdAt),
    minimumCreatedAt: Number(current.minimumCreatedAt),
    revision: Number(current.revision),
    status: current.status,
  };
}

export async function changeSaleDate(
  db: D1Database,
  scope: Scope,
  body: Record<string, unknown>,
  consumeBudget?: () => Promise<void>,
) {
  const { actorId, saleId, storeId } = scope;
  if (
    Object.keys(body).some(
      (key) => !['operationId', 'expected', 'createdAt'].includes(key),
    )
  )
    throw new HttpError(
      400,
      'A alteração contém um campo não reconhecido.',
      'UNKNOWN_FIELD',
    );
  const operationId = operationIdField(body.operationId);
  const rawExpected = body.expected;
  if (
    !rawExpected ||
    typeof rawExpected !== 'object' ||
    Array.isArray(rawExpected) ||
    Object.keys(rawExpected).some(
      (key) => !['createdAt', 'revision'].includes(key),
    )
  )
    throw new HttpError(
      400,
      'Reabra a venda antes de alterar a data.',
      'INVALID_EXPECTED',
    );
  const expectedObject = rawExpected as Record<string, unknown>;
  const expected = {
    createdAt: integerField(expectedObject.createdAt, 'Data anterior', {
      min: 0,
    }),
    revision: integerField(expectedObject.revision, 'Versão da venda', {
      min: 0,
      max: 1_000_000,
    }),
  };
  const createdAt = integerField(body.createdAt, 'Data da venda', {
    min: MINIMUM_SALE_DATE,
  });
  const input = { expected, createdAt };

  const readReplay = async () => {
    const event = await db
      .prepare(
        `SELECT store_id AS storeId, actor_user_id AS actorId,
          entity_id AS saleId, action, details_json AS details
         FROM audit_events WHERE id=?`,
      )
      .bind(operationId)
      .first<{
        action: string;
        actorId: string;
        details: string;
        saleId: string;
        storeId: string;
      }>();
    if (!event) return false;
    let eventInput: unknown;
    try {
      eventInput = JSON.parse(event.details).input;
    } catch {
      /* Invalid historical audits cannot be replayed. */
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
      current: await readSaleDate(db, storeId, saleId),
    };
  if (createdAt > Date.now() + MAXIMUM_FUTURE_SKEW)
    throw new HttpError(
      400,
      'A data da venda não pode estar no futuro.',
      'SALE_DATE_IN_FUTURE',
    );

  await consumeBudget?.();
  const before = await readSaleDate(db, storeId, saleId);
  if (before.status !== 'completed')
    throw new HttpError(
      409,
      'A data de uma venda cancelada não pode ser alterada.',
      'SALE_CANCELLED',
    );
  if (
    before.createdAt !== expected.createdAt ||
    before.revision !== expected.revision
  )
    throw new HttpError(
      409,
      'A data da venda foi alterada por outra pessoa. Reabra a venda e confira antes de salvar.',
      'SALE_CHANGED',
    );
  if (createdAt < before.minimumCreatedAt)
    throw new HttpError(
      409,
      'A venda não pode ficar antes da entrada dos aparelhos no estoque.',
      'SALE_BEFORE_STOCK_ENTRY',
    );
  if (createdAt === before.createdAt)
    throw new HttpError(
      400,
      'Escolha uma data ou horário diferente do atual.',
      'SALE_DATE_UNCHANGED',
    );

  const after = { createdAt };
  const details = JSON.stringify({ input, before, after });
  const now = Date.now();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO audit_events
            (id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
           SELECT ?,?,?,?,'sale',CASE WHEN
             EXISTS (SELECT 1 FROM sales
               WHERE id=? AND store_id=? AND status='completed' AND created_at=?)
             AND (SELECT COUNT(*) FROM audit_events
               WHERE store_id=? AND entity_id=? AND action=?)=?
             AND NOT EXISTS (
               SELECT 1 FROM sale_items si
               JOIN inventory_units iu ON iu.id=si.inventory_unit_id AND iu.store_id=si.store_id
               JOIN entries e ON e.id=iu.entry_id AND e.store_id=iu.store_id
               WHERE si.store_id=? AND si.sale_id=? AND e.created_at>?
             )
           THEN ? ELSE NULL END,?,?`,
        )
        .bind(
          operationId,
          storeId,
          actorId,
          ACTION,
          saleId,
          storeId,
          expected.createdAt,
          storeId,
          saleId,
          ACTION,
          expected.revision,
          storeId,
          saleId,
          createdAt,
          saleId,
          details,
          now,
        ),
      db
        .prepare(
          `UPDATE sales SET created_at=?
           WHERE id=? AND store_id=? AND status='completed' AND created_at=?`,
        )
        .bind(createdAt, saleId, storeId, expected.createdAt),
      db
        .prepare(
          `UPDATE inventory_units SET sold_at=?
           WHERE store_id=? AND sale_id=? AND status='sold'`,
        )
        .bind(createdAt, storeId, saleId),
    ]);
  } catch (error) {
    if (await readReplay())
      return {
        ok: true,
        replayed: true,
        current: await readSaleDate(db, storeId, saleId),
      };
    if (error instanceof Error && /constraint failed/i.test(error.message))
      throw new HttpError(
        409,
        'A venda ou o estoque mudou durante o envio. Reabra a venda para conferir.',
        'SALE_CHANGED',
      );
    throw error;
  }
  return {
    ok: true,
    replayed: false,
    current: await readSaleDate(db, storeId, saleId),
  };
}
