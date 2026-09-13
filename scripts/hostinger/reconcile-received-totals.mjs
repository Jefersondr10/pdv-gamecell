// One-shot maintenance for the historical sales cache only. The financial
// source of truth remains cash payments plus accepted receipt documents.
import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, mkdir, stat, statfs } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import {
  SALE_CASH_TOTAL_SQL,
  SALE_PIX_TOTAL_SQL,
  SALE_RECEIPT_TOTAL_SQL,
  SALE_RECEIVED_TOTAL_SQL,
  acceptedReceiptSql,
} from '../../lib/server/sale-status-sql.ts';

const SCRIPT_VERSION = 1;
const RULE_VERSION = 'cash-plus-accepted-receipts-v1';
const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const usage =
  'Usage: node --experimental-transform-types scripts/hostinger/reconcile-received-totals.mjs /absolute/path/to/pdv.sqlite [--dry-run] or --apply --run-id <id> --commit <git-sha>';

function parseArguments(argv) {
  const [databasePath, ...flags] = argv;
  if (!databasePath || !isAbsolute(databasePath)) throw new Error(usage);
  let mode = 'dry-run';
  let runId = null;
  let sourceCommit = null;
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === '--dry-run') mode = 'dry-run';
    else if (flag === '--apply') mode = 'apply';
    else if (flag === '--run-id') runId = flags[++index] ?? null;
    else if (flag === '--commit') sourceCommit = flags[++index] ?? null;
    else throw new Error(usage);
  }
  if (
    mode === 'apply' &&
    (!runId ||
      !/^[a-zA-Z0-9._:-]{1,80}$/.test(runId) ||
      !sourceCommit ||
      !/^[a-f0-9]{7,64}$/i.test(sourceCommit))
  )
    throw new Error(
      'Apply mode requires a safe --run-id and a 7-64 character hexadecimal --commit.',
    );
  return { databasePath, mode, runId, sourceCommit };
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function tableExists(db, name) {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type='table' AND name=? LIMIT 1",
      )
      .get(name),
  );
}

function assertSchema(db) {
  const requiredTables = [
    'sales',
    'payments',
    'attachments',
    'receipt_payment_links',
    'receipt_ocr_jobs',
    'sale_receipt_payment_sync',
    'file_deletion_jobs',
    'inventory_units',
    'sale_items',
    'audit_events',
    'users',
  ];
  const missingTables = requiredTables.filter((name) => !tableExists(db, name));
  if (missingTables.length)
    throw new Error('The database is missing required receipt migrations.');
  const requiredColumns = {
    sales: [
      'store_id',
      'seller_user_id',
      'products_total_cents',
      'received_total_cents',
      'received_difference_cents',
      'status',
    ],
    attachments: [
      'receipt_amount_cents',
      'receipt_details_json',
      'receipt_review_reason',
    ],
  };
  for (const [table, required] of Object.entries(requiredColumns)) {
    const present = new Set(
      db
        .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
        .all()
        .map((column) => column.name),
    );
    if (required.some((column) => !present.has(column)))
      throw new Error(
        'The database schema is not current enough for this repair.',
      );
  }
}

function assertDatabaseHealth(db) {
  const quickCheck = db.prepare('PRAGMA quick_check').all();
  if (
    quickCheck.length !== 1 ||
    String(quickCheck[0].quick_check).toLowerCase() !== 'ok'
  )
    throw new Error('SQLite quick check failed; no repair was applied.');
  if (db.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('SQLite foreign key check failed; no repair was applied.');
}

function queueState(db) {
  return {
    pendingOcrJobs: Number(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM receipt_ocr_jobs WHERE status IN ('pending','processing','retry')",
        )
        .get().count,
    ),
    pendingReceiptSyncs: Number(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM sale_receipt_payment_sync WHERE status='pending'",
        )
        .get().count,
    ),
  };
}

function assertQueuesIdle(db) {
  const queues = queueState(db);
  if (queues.pendingOcrJobs || queues.pendingReceiptSyncs)
    throw new Error(
      'Receipt processing is still active. Wait for the OCR and payment queues before retrying.',
    );
  return queues;
}

function assertFinancialValues(db) {
  const invalidSales = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM sales
         WHERE typeof(products_total_cents)<>'integer'
            OR products_total_cents < 0
            OR products_total_cents > ?
            OR typeof(received_total_cents)<>'integer'
            OR typeof(received_difference_cents)<>'integer'`,
      )
      .get(MAX_SAFE_INTEGER).count,
  );
  const invalidPayments = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM payments
         WHERE method NOT IN ('cash','pix')
            OR typeof(amount_cents)<>'integer'
            OR amount_cents <= 0
            OR amount_cents > ?`,
      )
      .get(MAX_SAFE_INTEGER).count,
  );
  if (invalidSales || invalidPayments)
    throw new Error(
      'Invalid stored financial values require manual investigation; no repair was applied.',
    );
}

const acceptedReceiptIdsSql = `COALESCE((
  SELECT json_group_array(accepted_receipt.id)
  FROM (
    SELECT ar.id
    FROM attachments ar
    WHERE ar.store_id=s.store_id
      AND ar.sale_id=s.id
      AND ar.kind='receipt'
      AND ${acceptedReceiptSql('ar')}
    ORDER BY ar.created_at, ar.id
  ) accepted_receipt
), '[]')`;

const planSql = `SELECT
  s.id,
  s.store_id,
  s.number,
  s.seller_user_id,
  s.products_total_cents,
  s.received_total_cents,
  s.received_difference_cents,
  ${SALE_CASH_TOTAL_SQL} AS cash_total_cents,
  ${SALE_RECEIPT_TOTAL_SQL} AS receipt_total_cents,
  ${SALE_RECEIVED_TOTAL_SQL} AS expected_received_total_cents,
  (${SALE_RECEIVED_TOTAL_SQL} - s.products_total_cents) AS expected_difference_cents,
  ${SALE_PIX_TOTAL_SQL} AS legacy_pix_total_cents,
  (SELECT COUNT(*) FROM payments legacy_pix
    WHERE legacy_pix.store_id=s.store_id
      AND legacy_pix.sale_id=s.id
      AND legacy_pix.method='pix') AS legacy_pix_count,
  ${acceptedReceiptIdsSql} AS accepted_receipt_ids_json
FROM sales s
WHERE s.status='completed'
  AND (
    s.received_total_cents <> ${SALE_RECEIVED_TOTAL_SQL}
    OR s.received_difference_cents <> (${SALE_RECEIVED_TOTAL_SQL} - s.products_total_cents)
  )
ORDER BY s.store_id, s.number, s.id`;

function loadPlan(db) {
  const rows = db.prepare(planSql).all();
  for (const row of rows) {
    const amounts = [
      row.products_total_cents,
      row.received_total_cents,
      row.received_difference_cents,
      row.cash_total_cents,
      row.receipt_total_cents,
      row.expected_received_total_cents,
      row.expected_difference_cents,
      row.legacy_pix_total_cents,
    ];
    if (amounts.some((amount) => !Number.isSafeInteger(amount)))
      throw new Error(
        'A computed financial total is outside the safe integer range; no repair was applied.',
      );
    const acceptedReceiptIds = JSON.parse(row.accepted_receipt_ids_json);
    if (
      !Array.isArray(acceptedReceiptIds) ||
      acceptedReceiptIds.some((id) => typeof id !== 'string')
    )
      throw new Error('Accepted receipt evidence could not be audited safely.');
    row.acceptedReceiptIds = acceptedReceiptIds;
  }
  return rows;
}

function countCancelledMismatches(db) {
  return Number(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM sales s
         WHERE s.status='cancelled'
           AND (s.received_total_cents <> ${SALE_RECEIVED_TOTAL_SQL}
             OR s.received_difference_cents <> (${SALE_RECEIVED_TOTAL_SQL} - s.products_total_cents))`,
      )
      .get().count,
  );
}

function digestQuery(db, sql) {
  const digest = createHash('sha256');
  let count = 0;
  for (const row of db.prepare(sql).iterate()) {
    digest.update(JSON.stringify(row));
    digest.update('\n');
    count += 1;
  }
  return { count, digest: digest.digest('hex') };
}

const exactProtectedTables = [
  'payments',
  'attachments',
  'receipt_payment_links',
  'inventory_units',
  'sale_items',
  'receipt_ocr_jobs',
  'sale_receipt_payment_sync',
  'file_deletion_jobs',
];

function captureProtectedState(db) {
  const state = {};
  for (const table of exactProtectedTables) {
    if (tableExists(db, table))
      state[table] = digestQuery(
        db,
        `SELECT * FROM ${quoteIdentifier(table)} ORDER BY rowid`,
      );
  }
  const immutableSaleColumns = db
    .prepare('PRAGMA table_info(sales)')
    .all()
    .map((column) => column.name)
    .filter(
      (column) =>
        column !== 'received_total_cents' &&
        column !== 'received_difference_cents',
    )
    .map(quoteIdentifier)
    .join(',');
  state.salesWithoutReceivedCache = digestQuery(
    db,
    `SELECT ${immutableSaleColumns} FROM sales ORDER BY rowid`,
  );
  state.cancelledSalesReceivedCache = digestQuery(
    db,
    `SELECT id, received_total_cents, received_difference_cents
     FROM sales WHERE status='cancelled' ORDER BY rowid`,
  );
  return state;
}

function captureBackupState(db) {
  return {
    protected: captureProtectedState(db),
    sales: digestQuery(db, 'SELECT * FROM sales ORDER BY rowid'),
    auditEvents: digestQuery(db, 'SELECT * FROM audit_events ORDER BY rowid'),
  };
}

function statesMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function countRows(db, table) {
  return Number(
    db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get()
      .count,
  );
}

async function createValidatedBackup(db, databasePath) {
  const archive = join(dirname(databasePath), 'backups');
  await mkdir(archive, { recursive: true, mode: 0o700 });
  const sourceSize = (await stat(databasePath)).size;
  const walSize = await stat(`${databasePath}-wal`)
    .then((metadata) => metadata.size)
    .catch((error) => {
      if (error?.code === 'ENOENT') return 0;
      throw error;
    });
  const disk = await statfs(dirname(databasePath));
  const availableBytes = Number(disk.bavail) * Number(disk.bsize);
  if (availableBytes < Math.max(64 * 1024 * 1024, (sourceSize + walSize) * 2))
    throw new Error(
      'Insufficient free disk space for a verified local backup.',
    );
  const backupPath = join(
    archive,
    `pre-received-total-reconciliation-${Date.now()}-${randomUUID().slice(0, 8)}.sqlite`,
  );
  await backup(db, backupPath);
  await chmod(backupPath, 0o600);
  return backupPath;
}

function validateBackup(backupPath, expectedState) {
  const snapshot = new DatabaseSync(backupPath, {
    readOnly: true,
    timeout: 5000,
  });
  try {
    snapshot.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    assertSchema(snapshot);
    assertDatabaseHealth(snapshot);
    if (!statesMatch(captureBackupState(snapshot), expectedState))
      throw new Error(
        'The safety backup does not match the locked database; no repair was applied.',
      );
  } finally {
    snapshot.close();
  }
}

function initialSummary(db, mode) {
  const queues = assertQueuesIdle(db);
  assertDatabaseHealth(db);
  assertFinancialValues(db);
  const plan = loadPlan(db);
  return {
    plan,
    output: {
      ok: true,
      mode,
      scriptVersion: SCRIPT_VERSION,
      ruleVersion: RULE_VERSION,
      completedSales: Number(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM sales WHERE status='completed'",
          )
          .get().count,
      ),
      mismatchedSales: plan.length,
      cancelledMismatches: countCancelledMismatches(db),
      ...queues,
    },
  };
}

async function main() {
  const { databasePath, mode, runId, sourceCommit } = parseArguments(
    process.argv.slice(2),
  );
  await access(databasePath);
  const db = new DatabaseSync(databasePath, {
    readOnly: mode === 'dry-run',
    timeout: 15_000,
  });
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=15000;');
  try {
    assertSchema(db);
    const initial = initialSummary(db, mode);
    if (mode === 'dry-run') {
      console.log(
        JSON.stringify({
          ...initial.output,
          requiresApply: initial.plan.length > 0,
        }),
      );
      return;
    }
    if (!initial.plan.length) {
      console.log(
        JSON.stringify({
          ...initial.output,
          repairedSales: 0,
          auditEventsAdded: 0,
          backupCreated: false,
          protectedDataVerified: true,
          remainingMismatches: 0,
        }),
      );
      return;
    }

    const dataVersionBeforeBackup = Number(
      db.prepare('PRAGMA data_version').get().data_version,
    );
    const backupPath = await createValidatedBackup(db, databasePath);
    db.exec('BEGIN IMMEDIATE');
    let committed = false;
    try {
      const dataVersionAfterLock = Number(
        db.prepare('PRAGMA data_version').get().data_version,
      );
      if (dataVersionAfterLock !== dataVersionBeforeBackup)
        throw new Error(
          'The database changed while the safety backup was being created; retry with the application stopped.',
        );
      assertQueuesIdle(db);
      assertDatabaseHealth(db);
      assertFinancialValues(db);

      const backupState = captureBackupState(db);
      validateBackup(backupPath, backupState);
      const protectedBefore = captureProtectedState(db);
      const lockedPlan = loadPlan(db);
      const auditCountBefore = countRows(db, 'audit_events');
      const createdAt = Date.now();
      const update = db.prepare(`UPDATE sales AS s
        SET received_total_cents=${SALE_RECEIVED_TOTAL_SQL},
            received_difference_cents=(${SALE_RECEIVED_TOTAL_SQL} - s.products_total_cents)
        WHERE s.id=? AND s.store_id=? AND s.status='completed'
          AND s.received_total_cents=? AND s.received_difference_cents=?`);
      const audit = db.prepare(`INSERT INTO audit_events
        (id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
        VALUES(?,?,?,?,?,?,?,?)`);

      for (const [index, sale] of lockedPlan.entries()) {
        const result = update.run(
          sale.id,
          sale.store_id,
          sale.received_total_cents,
          sale.received_difference_cents,
        );
        if (Number(result.changes) !== 1)
          throw new Error(
            'A planned sale changed before its cache update; no repair was applied.',
          );
        audit.run(
          randomUUID(),
          sale.store_id,
          sale.seller_user_id,
          'maintenance.sale_received_totals_reconciled',
          'sale',
          sale.id,
          JSON.stringify({
            scriptVersion: SCRIPT_VERSION,
            ruleVersion: RULE_VERSION,
            runId,
            sourceCommit: sourceCommit.toLowerCase(),
            actorIsCustodianNotExecutor: true,
            before: {
              receivedTotalCents: sale.received_total_cents,
              receivedDifferenceCents: sale.received_difference_cents,
            },
            after: {
              receivedTotalCents: sale.expected_received_total_cents,
              receivedDifferenceCents: sale.expected_difference_cents,
            },
            evidence: {
              productsTotalCents: sale.products_total_cents,
              cashTotalCents: sale.cash_total_cents,
              acceptedReceiptTotalCents: sale.receipt_total_cents,
              acceptedReceiptIds: sale.acceptedReceiptIds,
              legacyPixPaymentCountIgnored: sale.legacy_pix_count,
              legacyPixTotalCentsIgnored: sale.legacy_pix_total_cents,
            },
            protectedRecordsChanged: false,
            safetyBackup: basename(backupPath),
          }),
          createdAt + index,
        );
      }

      const remainingMismatches = loadPlan(db).length;
      if (remainingMismatches)
        throw new Error(
          'Some completed sales still have inconsistent received totals; no repair was applied.',
        );
      if (!statesMatch(protectedBefore, captureProtectedState(db)))
        throw new Error(
          'Protected payment, receipt, link, or stock data changed; no repair was applied.',
        );
      const auditEventsAdded = countRows(db, 'audit_events') - auditCountBefore;
      if (auditEventsAdded !== lockedPlan.length)
        throw new Error(
          'Per-sale audit validation failed; no repair was applied.',
        );
      assertQueuesIdle(db);
      assertDatabaseHealth(db);
      const cancelledMismatches = countCancelledMismatches(db);
      db.exec('COMMIT');
      committed = true;

      console.log(
        JSON.stringify({
          ok: true,
          mode: 'apply',
          scriptVersion: SCRIPT_VERSION,
          ruleVersion: RULE_VERSION,
          repairedSales: lockedPlan.length,
          auditEventsAdded,
          remainingMismatches: 0,
          cancelledMismatches,
          backupCreated: true,
          backupFile: basename(backupPath),
          protectedDataVerified: true,
        }),
      );
    } catch (error) {
      if (!committed) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Preserve the original validation or commit error.
        }
      }
      throw error;
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error:
        error instanceof Error ? error.message : 'Unknown maintenance error.',
    }),
  );
  process.exitCode = 1;
});
