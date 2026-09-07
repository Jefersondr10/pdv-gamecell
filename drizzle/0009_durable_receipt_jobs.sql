CREATE TABLE `receipt_ocr_jobs` (
	`attachment_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`next_attempt_at` integer NOT NULL,
	`error_code` text,
	`confidence` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_receipt_ocr_ready` ON `receipt_ocr_jobs` (`status`,`next_attempt_at`,`lease_until`);