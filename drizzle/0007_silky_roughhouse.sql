ALTER TABLE `attachments` ADD `receipt_amount_cents` integer;--> statement-breakpoint
ALTER TABLE `attachments` ADD `receipt_amount_source` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD `receipt_amount_confirmed_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `attachments` ADD `receipt_amount_confirmed_at` integer;