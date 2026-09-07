CREATE TABLE `store_backup_alert_settings` (
	`store_id` text PRIMARY KEY NOT NULL,
	`email` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_by` text NOT NULL,
	`mutation_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
