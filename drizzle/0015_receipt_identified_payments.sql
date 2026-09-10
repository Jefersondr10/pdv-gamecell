CREATE TABLE `receipt_payment_links` (
	`attachment_id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_receipt_payment_transaction` ON `receipt_payment_links` (`store_id`,`transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_receipt_payment_payment` ON `receipt_payment_links` (`payment_id`);--> statement-breakpoint
CREATE INDEX `idx_receipt_payment_sale` ON `receipt_payment_links` (`sale_id`,`store_id`);--> statement-breakpoint
ALTER TABLE `attachments` ADD `receipt_details_json` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD `receipt_review_reason` text;--> statement-breakpoint
ALTER TABLE `pix_accounts` ADD `receipt_bank` text;--> statement-breakpoint
ALTER TABLE `pix_accounts` ADD `receipt_recipient_document` text;