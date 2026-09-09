CREATE TABLE `file_deletion_jobs` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`r2_key` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_file_deletion_ready` ON `file_deletion_jobs` (`next_attempt_at`);