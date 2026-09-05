import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  apiError,
  assertSameOrigin,
  boundedJson,
  HttpError,
  integerField,
  json,
  operationIdField,
  stringField,
} from '@/lib/server/http';
import { consumeStoreWriteBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';

export const dynamic = 'force-dynamic';

type PaymentMethod = 'pix' | 'cash';

type SaleBalance = {
  number: number;
  status: 'completed' | 'cancelled';
  productsTotalCents: number;
  receivedTotalCents: number;
};

type AddedPayment = {
  id: string;
  method: PaymentMethod;
  pixAccountId: string | null;
  accountName: string | null;
  amountCents: number;
  number: number;
  productsTotalCents: number;
  receivedTotalCents: number;
  receivedDifferenceCents: number;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let paymentId: string | null = null;
  let storeId: string | null = null;
  let saleId: string | null = null;
  let method: PaymentMethod | null = null;
  let pixAccountId: string | null = null;
  let amountCents: number | null = null;
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    storeId = session.storeId!;
    assertCsrf(request, session);
    ({ id: saleId } = await context.params);
    const body = await boundedJson(request);
    if (
      Object.keys(body).some(
        (key) =>
          key !== 'operationId' &&
          key !== 'method' &&
          key !== 'pixAccountId' &&
          key !== 'amountCents',
      )
    ) {
      throw new HttpError(
        400,
        'O pagamento contém um campo não reconhecido.',
        'UNKNOWN_FIELD',
      );
    }
    paymentId = operationIdField(body.operationId);
    method =
      body.method === 'pix' ? 'pix' : body.method === 'cash' ? 'cash' : null;
    if (!method) {
      throw new HttpError(
        400,
        'Forma de pagamento inválida.',
        'INVALID_PAYMENT',
      );
    }
    pixAccountId =
      method === 'pix'
        ? stringField(body.pixAccountId, 'Conta Pix', { max: 80 })
        : null;
    amountCents = integerField(body.amountCents, 'Valor do pagamento', {
      min: 1,
      max: 1_000_000_000,
    });

    const db = runtime().DB;
    const replay = await findAddedPayment(db, storeId, saleId, paymentId);
    if (replay) {
      assertSamePayment(replay, method, pixAccountId, amountCents);
      return paymentResponse(replay, true);
    }

    const sale = await db
      .prepare(
        `SELECT number, status,
                products_total_cents AS productsTotalCents,
                received_total_cents AS receivedTotalCents
         FROM sales WHERE id = ? AND store_id = ? LIMIT 1`,
      )
      .bind(saleId, storeId)
      .first<SaleBalance>();
    if (!sale) {
      throw new HttpError(404, 'Venda não encontrada.', 'SALE_NOT_FOUND');
    }
    if (sale.status === 'cancelled') {
      throw new HttpError(
        409,
        'Uma venda cancelada não pode receber pagamentos.',
        'SALE_CANCELLED',
      );
    }
    const productsTotalCents = Number(sale.productsTotalCents);
    const previousReceivedCents = Number(sale.receivedTotalCents);
    const pendingCents = productsTotalCents - previousReceivedCents;
    if (pendingCents <= 0) {
      throw new HttpError(
        409,
        'Esta venda não possui pagamento pendente.',
        'SALE_ALREADY_PAID',
      );
    }
    if (amountCents > pendingCents) {
      throw new HttpError(
        400,
        `O valor informado é maior que o saldo pendente de ${formatMoney(pendingCents)}.`,
        'PAYMENT_EXCEEDS_BALANCE',
      );
    }
    let pixAccountName: string | null = null;
    if (pixAccountId) {
      const account = await db
        .prepare(
          `SELECT name FROM pix_accounts
           WHERE id = ? AND store_id = ? AND active = 1 LIMIT 1`,
        )
        .bind(pixAccountId, storeId)
        .first<{ name: string }>();
      if (!account) {
        throw new HttpError(
          409,
          'Selecione uma conta Pix ativa.',
          'PIX_ACCOUNT_INVALID',
        );
      }
      pixAccountName = account.name;
    }

    const now = Date.now();
    await consumeStoreWriteBudget(db, now, storeId, 4);
    const expectedReceivedCents = previousReceivedCents + amountCents;
    // A auditoria usa a mesma chave da operação. Numa corrida, a tentativa
    // perdedora força rollback e segue para a leitura/validação abaixo.
    const auditId = paymentId;
    let committedPayment: AddedPayment | null = null;
    try {
      const batchResults = await db.batch([
        db
          .prepare(
            `INSERT INTO payments
             (id, store_id, sale_id, method, pix_account_id,
              account_name, amount_cents, created_at)
             SELECT ?, sale.store_id, sale.id, ?, ?,
                    CASE WHEN ? = 'pix' THEN account.name ELSE NULL END,
                    ?, ?
             FROM sales sale
             LEFT JOIN pix_accounts account
               ON account.id = ? AND account.store_id = sale.store_id
              AND account.active = 1
             WHERE sale.id = ? AND sale.store_id = ?
               AND sale.status = 'completed'
               AND sale.received_total_cents = ?
               AND sale.products_total_cents > sale.received_total_cents
               AND ? <= sale.products_total_cents - sale.received_total_cents
               AND (? = 'cash' OR account.id IS NOT NULL)`,
          )
          .bind(
            paymentId,
            method,
            pixAccountId,
            method,
            amountCents,
            now,
            pixAccountId,
            saleId,
            storeId,
            previousReceivedCents,
            amountCents,
            method,
          ),
        db
          .prepare(
            `UPDATE sales
             SET received_total_cents = received_total_cents + ?,
                 received_difference_cents =
                   (received_total_cents + ?) - products_total_cents
             WHERE id = ? AND store_id = ? AND status = 'completed'
               AND received_total_cents = ?
               AND EXISTS (
                 SELECT 1 FROM payments
                 WHERE id = ? AND sale_id = sales.id AND store_id = sales.store_id
               )`,
          )
          .bind(
            amountCents,
            amountCents,
            saleId,
            storeId,
            previousReceivedCents,
            paymentId,
          ),
        db
          .prepare(
            `INSERT INTO audit_events
             (id, store_id, actor_user_id, action, entity_type, entity_id,
              details_json, created_at)
             VALUES (?, ?, ?, 'sale.payment_added', 'sale',
               CASE WHEN EXISTS (
                 SELECT 1 FROM payments
                 WHERE id = ? AND sale_id = ? AND store_id = ?
               ) AND EXISTS (
                 SELECT 1 FROM sales
                 WHERE id = ? AND store_id = ? AND status = 'completed'
                   AND received_total_cents = ?
               ) THEN ? ELSE NULL END,
               ?, ?)`,
          )
          .bind(
            auditId,
            storeId,
            session.id,
            paymentId,
            saleId,
            storeId,
            saleId,
            storeId,
            expectedReceivedCents,
            saleId,
            JSON.stringify({
              paymentId,
              method,
              amountCents,
              previousReceivedCents,
              receivedTotalCents: expectedReceivedCents,
            }),
            now,
          ),
        addedPaymentQuery(db, storeId, saleId, paymentId),
      ]);
      const saved = (batchResults.at(-1) as D1Result<AddedPayment> | undefined)
        ?.results?.[0];
      if (saved) committedPayment = normalizeAddedPayment(saved);
    } catch (error) {
      let saved: Awaited<ReturnType<typeof findAddedPayment>> = null;
      try {
        saved = await findAddedPayment(db, storeId, saleId, paymentId);
      } catch {
        // A resposta original continua sendo a melhor informação disponível.
      }
      if (saved) {
        assertSamePayment(saved, method, pixAccountId, amountCents);
        return paymentResponse(saved, true);
      }
      if (
        error instanceof Error &&
        /NOT NULL constraint failed:\s*audit_events\.entity_id/i.test(
          error.message,
        )
      ) {
        throw new HttpError(
          409,
          'A venda foi alterada em outra operação. Atualize e tente novamente.',
          'SALE_CHANGED',
        );
      }
      throw error;
    }

    if (committedPayment) {
      assertSamePayment(committedPayment, method, pixAccountId, amountCents);
      return paymentResponse(committedPayment, false, 201);
    }
    return paymentResponse(
      {
        id: paymentId,
        method,
        pixAccountId,
        accountName: pixAccountName,
        amountCents,
        number: Number(sale.number),
        productsTotalCents,
        receivedTotalCents: expectedReceivedCents,
        receivedDifferenceCents: expectedReceivedCents - productsTotalCents,
      },
      false,
      201,
    );
  } catch (error) {
    if (
      !(error instanceof HttpError) &&
      paymentId &&
      storeId &&
      saleId &&
      method &&
      amountCents
    ) {
      let saved: Awaited<ReturnType<typeof findAddedPayment>> = null;
      try {
        saved = await findAddedPayment(
          runtime().DB,
          storeId,
          saleId,
          paymentId,
        );
      } catch {
        // Continue com o erro original se o resultado não puder ser confirmado.
      }
      if (saved) {
        try {
          assertSamePayment(saved, method, pixAccountId, amountCents);
        } catch (mismatch) {
          return apiError(mismatch);
        }
        return paymentResponse(saved, true);
      }
    }
    return apiError(error);
  }
}

async function findAddedPayment(
  db: D1Database,
  storeId: string,
  saleId: string,
  paymentId: string,
) {
  const result = await addedPaymentQuery(
    db,
    storeId,
    saleId,
    paymentId,
  ).first<AddedPayment>();
  if (!result) return null;
  return normalizeAddedPayment(result);
}

function addedPaymentQuery(
  db: D1Database,
  storeId: string,
  saleId: string,
  paymentId: string,
) {
  return db
    .prepare(
      `SELECT payment.id, payment.method,
              payment.pix_account_id AS pixAccountId,
              payment.account_name AS accountName,
              payment.amount_cents AS amountCents,
              sale.number,
              sale.products_total_cents AS productsTotalCents,
              sale.received_total_cents AS receivedTotalCents,
              sale.received_difference_cents AS receivedDifferenceCents
       FROM payments payment
       JOIN sales sale
         ON sale.id = payment.sale_id AND sale.store_id = payment.store_id
       WHERE payment.id = ? AND payment.sale_id = ?
         AND payment.store_id = ? LIMIT 1`,
    )
    .bind(paymentId, saleId, storeId);
}

function normalizeAddedPayment(result: AddedPayment): AddedPayment {
  return {
    ...result,
    number: Number(result.number),
    amountCents: Number(result.amountCents),
    productsTotalCents: Number(result.productsTotalCents),
    receivedTotalCents: Number(result.receivedTotalCents),
    receivedDifferenceCents: Number(result.receivedDifferenceCents),
  };
}

function assertSamePayment(
  payment: AddedPayment,
  method: PaymentMethod,
  pixAccountId: string | null,
  amountCents: number,
) {
  if (
    payment.method !== method ||
    payment.pixAccountId !== pixAccountId ||
    payment.amountCents !== amountCents
  ) {
    throw new HttpError(
      409,
      'Esta operação já foi usada em outro pagamento.',
      'OPERATION_ALREADY_USED',
    );
  }
}

function paymentResponse(
  payment: AddedPayment,
  replayed: boolean,
  status = 200,
) {
  return json(
    {
      ok: true,
      payment: {
        id: payment.id,
        method: payment.method,
        accountName: payment.accountName,
        amountCents: payment.amountCents,
      },
      sale: {
        number: payment.number,
        productsTotalCents: payment.productsTotalCents,
        receivedTotalCents: payment.receivedTotalCents,
        receivedDifferenceCents: payment.receivedDifferenceCents,
      },
      replayed,
    },
    { status },
  );
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}
