CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_series_owner_updated` ON `series` (`owner`,`updated`);--> statement-breakpoint
CREATE TABLE `series_assets` (
	`series_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`data` text NOT NULL,
	`source_project` text NOT NULL,
	`updated` integer NOT NULL,
	PRIMARY KEY(`series_id`, `asset_id`),
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `productions` ADD `category` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `productions` ADD `series_id` text REFERENCES series(id);