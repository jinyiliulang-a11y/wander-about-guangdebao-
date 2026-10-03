CREATE TABLE `task_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`action` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_valid_action" CHECK("task_reviews"."action" IN ('published','rejected','offline','featured','unfeatured'))
);
--> statement-breakpoint
CREATE INDEX `idx_task_reviews_task_time` ON `task_reviews` (`task_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `is_featured` integer DEFAULT false NOT NULL;