CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`event_id` text NOT NULL,
	`store_id` text NOT NULL,
	`task_id` text NOT NULL,
	`coupon_code` text NOT NULL,
	`issued_at` integer NOT NULL,
	`redeemed_at` integer,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_claim_player_event_store` ON `claims` (`player_id`,`event_id`,`store_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_coupon_code` ON `claims` (`coupon_code`);--> statement-breakpoint
CREATE INDEX `idx_claim_store` ON `claims` (`store_id`);--> statement-breakpoint
CREATE INDEX `idx_claim_task` ON `claims` (`task_id`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`task_id` text NOT NULL,
	`clarity` integer NOT NULL,
	`comment` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_feedback_player_task` ON `feedback` (`player_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`nickname` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`player_id` text,
	`store_id` text,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`floor` text NOT NULL,
	`area` text NOT NULL,
	`category` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`code_hash` text NOT NULL,
	`reward_title` text NOT NULL,
	`conditions` text NOT NULL,
	`stock_total` integer NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`artwork` integer NOT NULL,
	CONSTRAINT "store_stock_nonnegative" CHECK("stores"."stock_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`store_id` text NOT NULL,
	`title` text NOT NULL,
	`clues` text NOT NULL,
	`status` text NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_valid_status" CHECK("tasks"."status" IN ('pending','published','rejected','offline'))
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`status`);