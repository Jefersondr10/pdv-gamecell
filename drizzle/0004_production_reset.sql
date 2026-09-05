-- One-time production cleanup requested by the owner before go-live.
DELETE FROM `login_attempts`;
--> statement-breakpoint
INSERT INTO `login_attempts`
  (`key_hash`, `attempts`, `blocked_until`, `updated_at`)
VALUES
  ('system:production-r2-reset-pending', 0, NULL, unixepoch() * 1000);
--> statement-breakpoint
DELETE FROM `attachments`;
--> statement-breakpoint
DELETE FROM `payments`;
--> statement-breakpoint
DELETE FROM `sale_items`;
--> statement-breakpoint
DELETE FROM `inventory_units`;
--> statement-breakpoint
DELETE FROM `sales`;
--> statement-breakpoint
DELETE FROM `entries`;
--> statement-breakpoint
DELETE FROM `product_codes`;
--> statement-breakpoint
DELETE FROM `products`;
--> statement-breakpoint
DELETE FROM `clients`;
--> statement-breakpoint
DELETE FROM `pix_accounts`;
--> statement-breakpoint
DELETE FROM `guide_reads`;
--> statement-breakpoint
DELETE FROM `sessions`;
--> statement-breakpoint
DELETE FROM `audit_events`;
--> statement-breakpoint
DELETE FROM `upload_reservations`;
--> statement-breakpoint
DELETE FROM `account_recovery_codes`;
--> statement-breakpoint
DELETE FROM `users`;
--> statement-breakpoint
DELETE FROM `stores`;
--> statement-breakpoint
PRAGMA optimize;
