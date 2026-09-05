CREATE TABLE `account_recovery_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`set_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_recovery_codes_user_set` ON `account_recovery_codes` (`user_id`,`set_id`);--> statement-breakpoint
DROP INDEX `idx_inventory_units_store_status`;--> statement-breakpoint
CREATE INDEX `idx_inventory_units_store_status` ON `inventory_units` (`store_id`,`status`,`created_at`,`id`);--> statement-breakpoint
ALTER TABLE `users` ADD `recovery_code_set_id` text;