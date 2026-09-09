CREATE TABLE `sale_receipt_payment_sync` (
	`sale_id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`request_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`target_payment_id` text,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_receipt_payment_pending` ON `sale_receipt_payment_sync` (`status`,`updated_at`);