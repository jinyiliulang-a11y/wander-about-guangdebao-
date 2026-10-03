CREATE TABLE `store_activities` (
  `id` text PRIMARY KEY NOT NULL,
  `event_id` text NOT NULL,
  `store_id` text NOT NULL REFERENCES `stores`(`id`),
  `author_id` text NOT NULL REFERENCES `players`(`id`),
  `request_id` text NOT NULL,
  `request_hash` text NOT NULL,
  `title` text NOT NULL,
  `description` text NOT NULL,
  `start_at` integer NOT NULL,
  `end_at` integer NOT NULL,
  `status` text NOT NULL,
  `review_note` text NOT NULL DEFAULT '',
  `revision` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `activity_title_length` CHECK(length(`title`) BETWEEN 1 AND 40),
  CONSTRAINT `activity_description_length` CHECK(length(`description`) BETWEEN 1 AND 500),
  CONSTRAINT `activity_time_order` CHECK(typeof(`start_at`)='integer' AND typeof(`end_at`)='integer'
    AND `start_at` > 0 AND `end_at` > `start_at` AND `end_at` <= 253402271999999),
  CONSTRAINT `activity_status` CHECK(`status` IN ('pending','published','rejected','offline')),
  CONSTRAINT `activity_review_note_length` CHECK(length(`review_note`) <= 160),
  CONSTRAINT `activity_revision_positive` CHECK(`revision` >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_activity_creation_request` ON `store_activities` (`event_id`,`store_id`,`request_id`);
--> statement-breakpoint
CREATE INDEX `idx_activity_public` ON `store_activities` (`event_id`,`status`,`end_at`,`store_id`);
--> statement-breakpoint
CREATE INDEX `idx_activity_store_updated` ON `store_activities` (`event_id`,`store_id`,`updated_at`);
