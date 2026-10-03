CREATE TABLE `hardware_claim_attempts` (
	`player_id` text NOT NULL,
	`store_id` text NOT NULL,
	`window_started_at` integer NOT NULL,
	`attempt_count` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "hardware_attempt_nonnegative" CHECK("hardware_claim_attempts"."attempt_count">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_hardware_attempt_player_store` ON `hardware_claim_attempts` (`player_id`,`store_id`);--> statement-breakpoint
CREATE TABLE `hardware_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`store_id` text NOT NULL,
	`request_id` text NOT NULL,
	`nonce` text NOT NULL,
	`code_hash` text NOT NULL,
	`auth_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_by` text,
	`claim_id` text,
	FOREIGN KEY (`device_id`) REFERENCES `hardware_devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`used_by`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "hardware_positive_lifetime" CHECK("hardware_codes"."expires_at">"hardware_codes"."created_at"),
	CONSTRAINT "hardware_use_pair" CHECK(("hardware_codes"."used_by" IS NULL AND "hardware_codes"."claim_id" IS NULL) OR ("hardware_codes"."used_by" IS NOT NULL AND "hardware_codes"."claim_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_hardware_request` ON `hardware_codes` (`device_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_hardware_code_store` ON `hardware_codes` (`store_id`,`code_hash`);--> statement-breakpoint
CREATE TABLE `hardware_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "hardware_enabled_boolean" CHECK("hardware_devices"."enabled" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `idx_hardware_device_store` ON `hardware_devices` (`store_id`);--> statement-breakpoint
-- Add the defaulted column in place. Rebuilding the referenced stores table
-- would be unnecessary and unsafe for existing claim/task foreign keys in D1.
ALTER TABLE `stores` ADD COLUMN `point_mode` text DEFAULT 'static' NOT NULL CONSTRAINT `store_point_mode` CHECK(`point_mode` IN ('static','hardware'));
