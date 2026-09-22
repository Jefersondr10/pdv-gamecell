import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
};

export const stores = sqliteTable(
  'stores',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    nextSaleNumber: integer('next_sale_number').notNull().default(1),
    storageLimitBytes: integer('storage_limit_bytes')
      .notNull()
      .default(2_147_483_648),
    ...timestamps,
  },
  (table) => [uniqueIndex('uq_stores_code').on(table.code)],
);

export const systemCatalogSyncs = sqliteTable('system_catalog_syncs', {
  storeId: text('store_id')
    .primaryKey()
    .references(() => stores.id, { onDelete: 'cascade' }),
  catalogVersion: integer('catalog_version').notNull().default(0),
  syncedAt: integer('synced_at', { mode: 'number' }).notNull(),
});

export const storeBackupAlertSettings = sqliteTable(
  'store_backup_alert_settings',
  {
    storeId: text('store_id')
      .primaryKey()
      .references(() => stores.id, { onDelete: 'cascade' }),
    email: text('email'),
    revision: integer('revision').notNull().default(0),
    updatedBy: text('updated_by').notNull(),
    mutationId: text('mutation_id').notNull(),
    ...timestamps,
  },
);

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id').references(() => stores.id),
    role: text('role', { enum: ['owner', 'admin', 'operator'] }).notNull(),
    permissionsJson: text('permissions_json'),
    authKind: text('auth_kind', { enum: ['google', 'password'] }).notNull(),
    googleSub: text('google_sub'),
    email: text('email'),
    usernameNormalized: text('username_normalized'),
    displayName: text('display_name').notNull(),
    photoUrl: text('photo_url'),
    passwordHash: text('password_hash'),
    passwordSalt: text('password_salt'),
    passwordIterations: integer('password_iterations'),
    recoveryCodeSetId: text('recovery_code_set_id'),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(false),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    sessionVersion: integer('session_version').notNull().default(1),
    createdBy: text('created_by'),
    lastLoginAt: integer('last_login_at', { mode: 'number' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('uq_users_google_sub').on(table.googleSub),
    uniqueIndex('uq_users_password_email')
      .on(table.email)
      .where(sql`${table.authKind} = 'password'`),
    uniqueIndex('uq_users_store_username').on(
      table.storeId,
      table.usernameNormalized,
    ),
    index('idx_users_store_active').on(table.storeId, table.active),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    idHash: text('id_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionVersion: integer('session_version').notNull(),
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_sessions_user').on(table.userId),
    index('idx_sessions_expires').on(table.expiresAt),
  ],
);

export const accountRecoveryCodes = sqliteTable(
  'account_recovery_codes',
  {
    codeHash: text('code_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    setId: text('set_id').notNull(),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_recovery_codes_user_set').on(table.userId, table.setId),
  ],
);

export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    keyHash: text('key_hash').primaryKey(),
    attempts: integer('attempts').notNull().default(0),
    blockedUntil: integer('blocked_until', { mode: 'number' }),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('idx_login_attempts_updated').on(table.updatedAt)],
);

export const uploadReservations = sqliteTable(
  'upload_reservations',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_upload_reservations_store_expiry').on(
      table.storeId,
      table.expiresAt,
    ),
    index('idx_upload_reservations_expiry').on(table.expiresAt),
  ],
);

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    color: text('color').notNull(),
    memory: text('memory').notNull(),
    defaultPriceCents: integer('default_price_cents').notNull().default(0),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (table) => [
    index('idx_products_store_active').on(table.storeId, table.active),
    uniqueIndex('uq_products_store_variation').on(
      table.storeId,
      table.model,
      table.color,
      table.memory,
    ),
  ],
);

export const productCodes = sqliteTable(
  'product_codes',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    kind: text('kind', { enum: ['UPC', 'EAN', 'JAN', 'OUTRO'] })
      .notNull()
      .default('EAN'),
    market: text('market'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_product_codes_store_code').on(table.storeId, table.code),
    index('idx_product_codes_product').on(table.productId),
  ],
);

export const clients = sqliteTable(
  'clients',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nameKey: text('name_key'),
    phone: text('phone'),
    email: text('email'),
    notes: text('notes'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (table) => [
    index('idx_clients_store_name').on(table.storeId, table.name),
    uniqueIndex('uq_clients_store_name_key').on(table.storeId, table.nameKey),
  ],
);

export const pixAccounts = sqliteTable(
  'pix_accounts',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    details: text('details'),
    receiptBank: text('receipt_bank'),
    receiptRecipientDocument: text('receipt_recipient_document'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('uq_pix_accounts_store_name').on(table.storeId, table.name),
  ],
);

export const orderStatuses = sqliteTable(
  'order_statuses',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    color: text('color', {
      enum: [
        'slate',
        'blue',
        'amber',
        'orange',
        'green',
        'red',
        'purple',
        'pink',
      ],
    })
      .notNull()
      .default('slate'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('uq_order_statuses_store_name').on(
      table.storeId,
      table.nameNormalized,
    ),
    index('idx_order_statuses_store_active').on(table.storeId, table.active),
  ],
);

export const entries = sqliteTable(
  'entries',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    operatorUserId: text('operator_user_id')
      .notNull()
      .references(() => users.id),
    quantity: integer('quantity').notNull(),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_entries_store_created').on(table.storeId, table.createdAt),
  ],
);

export const sales = sqliteTable(
  'sales',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    customerId: text('customer_id').references(() => clients.id),
    customerName: text('customer_name').notNull(),
    sellerUserId: text('seller_user_id')
      .notNull()
      .references(() => users.id),
    sellerName: text('seller_name').notNull(),
    orderStatusId: text('order_status_id').references(() => orderStatuses.id),
    productsTotalCents: integer('products_total_cents').notNull(),
    receivedTotalCents: integer('received_total_cents').notNull(),
    receivedDifferenceCents: integer('received_difference_cents').notNull(),
    referenceTotalCents: integer('reference_total_cents').notNull(),
    priceDifferenceCents: integer('price_difference_cents').notNull(),
    status: text('status', { enum: ['completed', 'cancelled'] })
      .notNull()
      .default('completed'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    cancelledAt: integer('cancelled_at', { mode: 'number' }),
    cancelledBy: text('cancelled_by').references(() => users.id),
    cancellationReason: text('cancellation_reason'),
  },
  (table) => [
    uniqueIndex('uq_sales_store_number').on(table.storeId, table.number),
    index('idx_sales_store_created').on(table.storeId, table.createdAt),
    index('idx_sales_store_status').on(table.storeId, table.status),
    index('idx_sales_store_order_status').on(
      table.storeId,
      table.orderStatusId,
    ),
  ],
);

export const saleReceiptPaymentSync = sqliteTable(
  'sale_receipt_payment_sync',
  {
    saleId: text('sale_id')
      .primaryKey()
      .references(() => sales.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    requestId: text('request_id').notNull(),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id),
    targetPaymentId: text('target_payment_id'),
    status: text('status', {
      enum: ['pending', 'review', 'applied', 'manual'],
    }).notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_receipt_payment_pending').on(table.status, table.updatedAt),
  ],
);

export const inventoryUnits = sqliteTable(
  'inventory_units',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id),
    serial: text('serial').notNull(),
    status: text('status', { enum: ['available', 'sold'] })
      .notNull()
      .default('available'),
    saleId: text('sale_id').references(() => sales.id),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    soldAt: integer('sold_at', { mode: 'number' }),
  },
  (table) => [
    uniqueIndex('uq_inventory_units_store_serial').on(
      table.storeId,
      table.serial,
    ),
    index('idx_inventory_units_store_status').on(
      table.storeId,
      table.status,
      table.createdAt,
      table.id,
    ),
    index('idx_inventory_units_product_status').on(
      table.productId,
      table.status,
    ),
    index('idx_inventory_units_entry').on(table.entryId),
  ],
);

export const saleItems = sqliteTable(
  'sale_items',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    inventoryUnitId: text('inventory_unit_id')
      .notNull()
      .references(() => inventoryUnits.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    productName: text('product_name').notNull(),
    productDetail: text('product_detail').notNull(),
    serial: text('serial').notNull(),
    referencePriceCents: integer('reference_price_cents').notNull(),
    soldPriceCents: integer('sold_price_cents').notNull(),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_sale_items_sale').on(table.saleId),
    index('idx_sale_items_store_product').on(table.storeId, table.productId),
  ],
);

export const payments = sqliteTable(
  'payments',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    method: text('method', { enum: ['pix', 'cash'] }).notNull(),
    pixAccountId: text('pix_account_id').references(() => pixAccounts.id),
    accountName: text('account_name'),
    amountCents: integer('amount_cents').notNull(),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('idx_payments_sale').on(table.saleId)],
);

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['entry_photo', 'item_photo', 'receipt', 'report'],
    }).notNull(),
    entryId: text('entry_id').references(() => entries.id, {
      onDelete: 'cascade',
    }),
    saleId: text('sale_id').references(() => sales.id, { onDelete: 'cascade' }),
    saleItemId: text('sale_item_id').references(() => saleItems.id, {
      onDelete: 'cascade',
    }),
    r2Key: text('r2_key').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    receiptAmountCents: integer('receipt_amount_cents'),
    receiptDetailsJson: text('receipt_details_json'),
    receiptReviewReason: text('receipt_review_reason'),
    receiptAmountSource: text('receipt_amount_source', {
      enum: ['ocr', 'manual'],
    }),
    receiptAmountConfirmedBy: text('receipt_amount_confirmed_by').references(
      () => users.id,
    ),
    receiptAmountConfirmedAt: integer('receipt_amount_confirmed_at', {
      mode: 'number',
    }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_attachments_r2_key').on(table.r2Key),
    index('idx_attachments_store_kind_entry').on(
      table.storeId,
      table.kind,
      table.entryId,
    ),
    index('idx_attachments_store_created').on(table.storeId, table.createdAt),
    index('idx_attachments_entry').on(table.entryId),
    index('idx_attachments_sale').on(table.saleId),
    index('idx_attachments_sale_item').on(table.saleItemId),
  ],
);

// Keep evidence claims after an attachment is removed: a deleted receipt must
// not silently pay a second sale. Payment/history deletion is never implied.
export const receiptPaymentLinks = sqliteTable(
  'receipt_payment_links',
  {
    attachmentId: text('attachment_id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id),
    transactionId: text('transaction_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_receipt_payment_transaction').on(
      table.storeId,
      table.transactionId,
    ),
    uniqueIndex('uq_receipt_payment_payment').on(table.paymentId),
    index('idx_receipt_payment_sale').on(table.saleId, table.storeId),
  ],
);

export const receiptOcrJobs = sqliteTable(
  'receipt_ocr_jobs',
  {
    attachmentId: text('attachment_id')
      .primaryKey()
      .references(() => attachments.id, { onDelete: 'cascade' }),
    status: text('status', {
      enum: [
        'pending',
        'processing',
        'retry',
        'done',
        'needs_review',
        'cancelled',
      ],
    })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    generation: integer('generation').notNull().default(1),
    readerRevision: integer('reader_revision').notNull().default(0),
    leaseToken: text('lease_token'),
    leaseUntil: integer('lease_until'),
    nextAttemptAt: integer('next_attempt_at').notNull(),
    errorCode: text('error_code'),
    confidence: text('confidence'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_receipt_ocr_ready').on(
      table.status,
      table.nextAttemptAt,
      table.leaseUntil,
    ),
  ],
);

// Transactional outbox: metadata removal cannot leave untracked private files.
export const fileDeletionJobs = sqliteTable(
  'file_deletion_jobs',
  {
    operationId: text('operation_id').primaryKey(),
    r2Key: text('r2_key').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('idx_file_deletion_ready').on(table.nextAttemptAt)],
);

export const reportShares = sqliteTable(
  'report_shares',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    attachmentId: text('attachment_id').references(() => attachments.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    operationId: text('operation_id').notNull(),
  },
  (table) => [
    uniqueIndex('uq_report_share_operation').on(
      table.storeId,
      table.operationId,
    ),
    index('idx_report_shares_expiry').on(table.expiresAt),
    index('idx_report_shares_store').on(table.storeId, table.createdAt),
  ],
);

export const guideReads = sqliteTable(
  'guide_reads',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    readAt: integer('read_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_guide_reads_user_version').on(table.userId, table.version),
  ],
);

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    detailsJson: text('details_json'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_audit_store_created').on(table.storeId, table.createdAt),
    index('idx_audit_store_action_entity').on(
      table.storeId,
      table.action,
      table.entityId,
    ),
  ],
);

export const stockReservations = sqliteTable(
  'stock_reservations',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    customerId: text('customer_id')
      .notNull()
      .references(() => clients.id),
    customerName: text('customer_name').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    expiresAt: integer('expires_at').notNull(),
    status: text('status', { enum: ['active', 'released', 'converted'] })
      .notNull()
      .default('active'),
    saleId: text('sale_id').references(() => sales.id),
    notes: text('notes').notNull().default(''),
    revision: integer('revision').notNull().default(0),
    fingerprint: text('fingerprint').notNull(),
    ...timestamps,
  },
  (table) => [
    index('idx_stock_reservations_store').on(
      table.storeId,
      table.status,
      table.expiresAt,
    ),
    check(
      'stock_reservation_status',
      sql`${table.status} IN ('active','released','converted')`,
    ),
  ],
);
export const stockReservationItems = sqliteTable(
  'stock_reservation_items',
  {
    reservationId: text('reservation_id')
      .notNull()
      .references(() => stockReservations.id),
    inventoryUnitId: text('inventory_unit_id')
      .notNull()
      .references(() => inventoryUnits.id),
  },
  (table) => [
    primaryKey({ columns: [table.reservationId, table.inventoryUnitId] }),
    index('idx_stock_reservation_unit').on(table.inventoryUnitId),
  ],
);
