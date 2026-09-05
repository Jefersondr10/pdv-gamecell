CREATE TABLE `order_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`color` text DEFAULT 'slate' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_order_statuses_store_name` ON `order_statuses` (`store_id`,`name_normalized`);--> statement-breakpoint
CREATE INDEX `idx_order_statuses_store_active` ON `order_statuses` (`store_id`,`active`);--> statement-breakpoint
ALTER TABLE `sales` ADD `order_status_id` text REFERENCES order_statuses(id);--> statement-breakpoint
CREATE INDEX `idx_sales_store_order_status` ON `sales` (`store_id`,`order_status_id`);
--> statement-breakpoint
PRAGMA optimize;
