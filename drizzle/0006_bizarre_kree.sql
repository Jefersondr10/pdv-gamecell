CREATE TABLE `system_catalog_syncs` (
	`store_id` text PRIMARY KEY NOT NULL,
	`catalog_version` integer DEFAULT 0 NOT NULL,
	`synced_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `product_codes` ADD `market` text;