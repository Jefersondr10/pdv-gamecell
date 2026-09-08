ALTER TABLE `clients` ADD `name_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_clients_store_name_key` ON `clients` (`store_id`,`name_key`);