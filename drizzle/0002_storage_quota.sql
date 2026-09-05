CREATE TABLE `upload_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_upload_reservations_store_expiry` ON `upload_reservations` (`store_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_upload_reservations_expiry` ON `upload_reservations` (`expires_at`);--> statement-breakpoint
ALTER TABLE `stores` ADD `storage_limit_bytes` integer DEFAULT 2147483648 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_attachments_store_kind_entry` ON `attachments` (`store_id`,`kind`,`entry_id`);--> statement-breakpoint
CREATE INDEX `idx_attachments_store_created` ON `attachments` (`store_id`,`created_at`);