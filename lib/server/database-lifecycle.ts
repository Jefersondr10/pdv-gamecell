// Application-owned tables that belong to a complete data migration.
// Keep this list explicit: deployment bookkeeping such as d1_migrations and
// pdv_release_migrations belongs to the destination environment, not the store
// snapshot being moved between environments.
export const MIGRATION_TABLES = [
  'stores',
  'system_catalog_syncs',
  'users',
  'sessions',
  'account_recovery_codes',
  'login_attempts',
  'upload_reservations',
  'products',
  'product_codes',
  'clients',
  'pix_accounts',
  'order_statuses',
  'entries',
  'sales',
  'inventory_units',
  'sale_items',
  'payments',
  'attachments',
  'receipt_ocr_jobs',
  'store_backup_alert_settings',
  'file_deletion_jobs',
  'sale_receipt_payment_sync',
  'receipt_payment_links',
  'guide_reads',
  'audit_events',
] as const;

// Child rows with NO ACTION foreign keys must precede their parents. Listing
// every application table also prevents queues or settings surviving a reset.
export const PRODUCTION_RESET_DELETE_ORDER = [
  'login_attempts',
  'file_deletion_jobs',
  'receipt_ocr_jobs',
  'receipt_payment_links',
  'sale_receipt_payment_sync',
  'attachments',
  'payments',
  'sale_items',
  'inventory_units',
  'sales',
  'order_statuses',
  'entries',
  'product_codes',
  'products',
  'clients',
  'pix_accounts',
  'guide_reads',
  'sessions',
  'audit_events',
  'upload_reservations',
  'account_recovery_codes',
  'store_backup_alert_settings',
  'system_catalog_syncs',
  'users',
  'stores',
] as const satisfies readonly (typeof MIGRATION_TABLES)[number][];

export const PRESERVED_INFRASTRUCTURE_TABLES = [
  'd1_migrations',
  'pdv_release_migrations',
] as const;
