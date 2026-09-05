DROP INDEX `uq_users_email`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_users_password_email` ON `users` (`email`) WHERE "users"."auth_kind" = 'password';--> statement-breakpoint
PRAGMA optimize;
