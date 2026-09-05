import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
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

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id').references(() => stores.id),
    role: text('role', { enum: ['owner', 'admin', 'operator'] }).notNull(),
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
    phone: text('phone'),
    email: text('email'),
    notes: text('notes'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (table) => [index('idx_clients_store_name').on(table.storeId, table.name)],
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
      enum: ['entry_photo', 'item_photo', 'receipt'],
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
  ],
);
