import { HttpError } from '@/lib/server/http';
import { requiredSecret } from '@/lib/server/runtime';
import { hmac } from '@/lib/server/security';

type FixedWindowLimit = {
  scope: string;
  windowMs: number;
  max: number;
  global?: boolean;
  cost?: number;
};

type WriteBudgetClass =
  | 'public-login'
  | 'public-registration'
  | 'public-oauth'
  | 'public-recovery'
  | 'account-security'
  | 'business'
  | 'control'
  | 'read';

const DAILY_WRITE_CREDITS: Record<WriteBudgetClass, number> = {
  // These are deployment-wide circuit breakers. The narrower limits below
  // remain responsible for containing abuse by IP, user and store.
  'public-login': 120_000,
  'public-registration': 60_000,
  'public-oauth': 120_000,
  'public-recovery': 60_000,
  'account-security': 80_000,
  business: 1_000_000,
  control: 300_000,
  read: 10_000_000,
};

export async function consumeFixedWindowLimits(
  db: D1Database,
  now: number,
  limits: FixedWindowLimit[],
  error: { message: string; code: string } = {
    message: 'Muitas contas foram solicitadas. Tente novamente mais tarde.',
    code: 'REGISTRATION_LIMIT',
  },
  order: 'global-first' | 'specific-first' = 'global-first',
  additionalWriteCost = 0,
  budgetClass: WriteBudgetClass = 'public-registration',
) {
  const secret = requiredSecret('RATE_LIMIT_SECRET_V1');
  const globalLimits = limits.filter((limit) => limit.global);
  const specificLimits = limits.filter((limit) => !limit.global);
  const orderedLimits =
    order === 'specific-first'
      ? [...specificLimits, ...globalLimits]
      : [...globalLimits, ...specificLimits];
  const keyedLimits = await Promise.all(
    orderedLimits.map(async (limit) => ({
      ...limit,
      cost: Math.max(1, Math.min(1_000, Math.trunc(limit.cost ?? 1))),
      key: await hmac(
        `${limit.scope}:${Math.floor(now / limit.windowMs)}`,
        secret,
      ),
    })),
  );
  const masterLimit = DAILY_WRITE_CREDITS[budgetClass];
  const masterKey = await hmac(
    `master-write:${budgetClass}:${Math.floor(now / (24 * 60 * 60 * 1000))}`,
    secret,
  );
  const allKeys = [masterKey, ...keyedLimits.map((limit) => limit.key)];
  const existing = await db
    .prepare(
      `SELECT key_hash AS keyHash, attempts
       FROM login_attempts
       WHERE key_hash IN (${allKeys.map(() => '?').join(', ')})`,
    )
    .bind(...allKeys)
    .all<{ keyHash: string; attempts: number }>();
  const attemptsByKey = new Map(
    (existing.results ?? []).map((row) => [row.keyHash, Number(row.attempts)]),
  );
  for (const limit of keyedLimits) {
    if ((attemptsByKey.get(limit.key) ?? 0) + limit.cost > limit.max) {
      throw new HttpError(429, error.message, error.code);
    }
  }

  const masterCost = Math.max(
    2,
    Math.min(
      5_000,
      Math.max(0, Math.trunc(additionalWriteCost)) + keyedLimits.length + 2,
    ),
  );
  if ((attemptsByKey.get(masterKey) ?? 0) + masterCost > masterLimit) {
    throw dailyLimitError(budgetClass);
  }
  const nonce = crypto.getRandomValues(new Uint32Array(1))[0] + 1;
  const counterStatements = keyedLimits.map((limit) =>
    db
      .prepare(
        `INSERT INTO login_attempts
         (key_hash, attempts, blocked_until, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key_hash) DO UPDATE SET
           attempts = login_attempts.attempts + excluded.attempts,
           blocked_until = excluded.blocked_until,
           updated_at = excluded.updated_at
         WHERE login_attempts.attempts + excluded.attempts <= ?`,
      )
      .bind(limit.key, limit.cost, nonce, now, limit.max),
  );
  const masterStatement = db
    .prepare(
      `INSERT INTO login_attempts
       (key_hash, attempts, blocked_until, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key_hash) DO UPDATE SET
         attempts = login_attempts.attempts + excluded.attempts,
         blocked_until = excluded.blocked_until,
         updated_at = excluded.updated_at
       WHERE login_attempts.attempts + excluded.attempts <= ?`,
    )
    .bind(masterKey, masterCost, nonce, now, masterLimit);
  const guardStatement = db
    .prepare(
      `UPDATE login_attempts
       SET updated_at = CASE WHEN (
         SELECT COUNT(*) FROM login_attempts
         WHERE key_hash IN (${allKeys.map(() => '?').join(', ')})
           AND blocked_until = ?
       ) = ? THEN updated_at ELSE NULL END
       WHERE key_hash = ?`,
    )
    .bind(...allKeys, nonce, allKeys.length, masterKey);
  try {
    await db.batch([...counterStatements, masterStatement, guardStatement]);
  } catch (batchError) {
    if (
      batchError instanceof Error &&
      /NOT NULL constraint failed:\s*login_attempts\.updated_at/i.test(
        batchError.message,
      )
    ) {
      const latestMaster = await db
        .prepare(
          'SELECT attempts FROM login_attempts WHERE key_hash = ? LIMIT 1',
        )
        .bind(masterKey)
        .first<{ attempts: number }>();
      if (Number(latestMaster?.attempts ?? 0) + masterCost > masterLimit) {
        throw dailyLimitError(budgetClass);
      }
      throw new HttpError(429, error.message, error.code);
    }
    throw batchError;
  }

  if (crypto.getRandomValues(new Uint8Array(1))[0] === 0) {
    await db
      .prepare(
        `DELETE FROM login_attempts WHERE key_hash IN (
           SELECT key_hash FROM login_attempts
           WHERE updated_at < ? AND key_hash NOT LIKE 'system:%'
           LIMIT 50
         )`,
      )
      .bind(now - 48 * 60 * 60 * 1000)
      .run();
  }
}

export async function consumeStoreWriteBudget(
  db: D1Database,
  now: number,
  storeId: string,
  cost: number,
) {
  await consumeFixedWindowLimits(
    db,
    now,
    [
      {
        scope: 'writes:global:hour',
        windowMs: 60 * 60 * 1000,
        max: 8_000,
        global: true,
        cost,
      },
      {
        scope: 'writes:global:day',
        windowMs: 24 * 60 * 60 * 1000,
        max: 75_000,
        global: true,
        cost,
      },
      {
        scope: `writes:store:${storeId}:hour`,
        windowMs: 60 * 60 * 1000,
        max: 2_000,
        cost,
      },
      {
        scope: `writes:store:${storeId}:day`,
        windowMs: 24 * 60 * 60 * 1000,
        max: 20_000,
        cost,
      },
      {
        scope: `writes:store:${storeId}:weighted-hour`,
        windowMs: 60 * 60 * 1000,
        max: 8_000,
        cost: cost * 4,
      },
      {
        scope: `writes:store:${storeId}:weighted-day`,
        windowMs: 24 * 60 * 60 * 1000,
        max: 15_000,
        cost: cost * 4,
      },
    ],
    {
      message:
        'Esta loja atingiu o limite de operações do período. Tente novamente mais tarde.',
      code: 'STORE_OPERATION_LIMIT',
    },
    'specific-first',
    cost * 4,
    'business',
  );
}

export async function consumeControlWriteBudget(
  db: D1Database,
  now: number,
  storeId: string,
  actorId: string,
  cost: number,
) {
  await consumeFixedWindowLimits(
    db,
    now,
    [
      {
        scope: `control:store:${storeId}:hour`,
        windowMs: 60 * 60 * 1000,
        max: 2_500,
        cost,
      },
      {
        scope: `control:store:${storeId}:day`,
        windowMs: 24 * 60 * 60 * 1000,
        max: 10_000,
        cost,
      },
      {
        scope: `control:store:${storeId}:weighted-hour`,
        windowMs: 60 * 60 * 1000,
        max: 1_000,
        cost: cost * 3,
      },
      {
        scope: `control:store:${storeId}:weighted-day`,
        windowMs: 24 * 60 * 60 * 1000,
        max: 3_000,
        cost: cost * 3,
      },
      {
        scope: `control:user:${actorId}:hour`,
        windowMs: 60 * 60 * 1000,
        max: 1_000,
        cost,
      },
      {
        scope: `control:user:${actorId}:day`,
        windowMs: 24 * 60 * 60 * 1000,
        max: 5_000,
        cost,
      },
      {
        scope: `control:user:${actorId}:weighted-hour`,
        windowMs: 60 * 60 * 1000,
        max: 1_000,
        cost: cost * 3,
      },
      {
        scope: `control:user:${actorId}:weighted-day`,
        windowMs: 24 * 60 * 60 * 1000,
        max: 2_000,
        cost: cost * 3,
      },
      {
        scope: 'control:global:hour',
        windowMs: 60 * 60 * 1000,
        max: 5_000,
        global: true,
        cost,
      },
      {
        scope: 'control:global:day',
        windowMs: 24 * 60 * 60 * 1000,
        max: 25_000,
        global: true,
        cost,
      },
    ],
    {
      message:
        'Muitas alterações foram solicitadas. Tente novamente mais tarde.',
      code: 'CONTROL_OPERATION_LIMIT',
    },
    'specific-first',
    cost * 3,
    'control',
  );
}

export async function consumeStoreReadBudget(
  db: D1Database,
  now: number,
  storeId: string,
  cost: number,
) {
  await consumeFixedWindowLimits(
    db,
    now,
    [
      {
        scope: `reads:v2:store:${storeId}:requests-hour`,
        windowMs: 60 * 60 * 1000,
        max: 600,
      },
      {
        scope: `reads:v2:store:${storeId}:requests-day`,
        windowMs: 24 * 60 * 60 * 1000,
        max: 6_000,
      },
      {
        scope: `reads:v2:store:${storeId}:weighted-hour`,
        windowMs: 60 * 60 * 1000,
        max: 8_000,
        cost,
      },
      {
        scope: `reads:v2:store:${storeId}:weighted-day`,
        windowMs: 24 * 60 * 60 * 1000,
        max: 80_000,
        cost,
      },
      {
        scope: 'reads:v2:global:weighted-hour',
        windowMs: 60 * 60 * 1000,
        max: 120_000,
        global: true,
        cost,
      },
      {
        scope: 'reads:v2:global:weighted-day',
        windowMs: 24 * 60 * 60 * 1000,
        max: 1_200_000,
        global: true,
        cost,
      },
    ],
    {
      message:
        'Muitas consultas foram solicitadas para esta loja. Aguarde um pouco e tente novamente.',
      code: 'STORE_READ_LIMIT',
    },
    'specific-first',
    0,
    'read',
  );
}

export async function consumeWriteCredits(
  db: D1Database,
  now: number,
  budgetClass: WriteBudgetClass,
  estimatedRows: number,
) {
  await consumeFixedWindowLimits(
    db,
    now,
    [],
    undefined,
    'global-first',
    estimatedRows,
    budgetClass,
  );
}

function dailyLimitError(budgetClass: WriteBudgetClass) {
  if (
    budgetClass === 'public-login' ||
    budgetClass === 'public-registration' ||
    budgetClass === 'public-oauth'
  ) {
    return new HttpError(
      429,
      'Muitas entradas e cadastros foram solicitados hoje. Tente novamente mais tarde.',
      'PUBLIC_AUTH_DAILY_LIMIT',
    );
  }
  if (budgetClass === 'account-security') {
    return new HttpError(
      429,
      'O limite diário de segurança foi atingido. Tente novamente mais tarde.',
      'ACCOUNT_SECURITY_DAILY_LIMIT',
    );
  }
  if (budgetClass === 'public-recovery') {
    return new HttpError(
      429,
      'Muitas recuperações foram solicitadas hoje. Tente novamente mais tarde.',
      'PUBLIC_RECOVERY_DAILY_LIMIT',
    );
  }
  return new HttpError(
    503,
    'O limite diário seguro desta operação foi atingido. Tente novamente amanhã.',
    'SYSTEM_DAILY_LIMIT',
  );
}
