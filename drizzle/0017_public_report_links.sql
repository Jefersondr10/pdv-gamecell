CREATE TABLE `report_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`created_by` text NOT NULL,
	`token_hash` text NOT NULL,
	`attachment_id` text,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`operation_id` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_shares_token_hash_unique` ON `report_shares` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_report_share_operation` ON `report_shares` (`store_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `idx_report_shares_expiry` ON `report_shares` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_report_shares_store` ON `report_shares` (`store_id`,`created_at`);