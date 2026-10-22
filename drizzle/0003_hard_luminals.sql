CREATE TABLE `pro_video_parts` (
	`video_id` text NOT NULL,
	`part_number` integer NOT NULL,
	`etag` text NOT NULL,
	`bytes` integer NOT NULL,
	PRIMARY KEY(`video_id`, `part_number`),
	FOREIGN KEY (`video_id`) REFERENCES `pro_videos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pro_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`creator` text NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`media_key` text NOT NULL,
	`upload_id` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`duration` integer NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`reviewed_by` text,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pro_videos_status_created` ON `pro_videos` (`status`,`created`);--> statement-breakpoint
CREATE INDEX `idx_pro_videos_owner_created` ON `pro_videos` (`owner`,`created`);