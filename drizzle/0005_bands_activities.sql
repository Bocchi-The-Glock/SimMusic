CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`location` text NOT NULL,
	`owner_id` text NOT NULL,
	`livehouse_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activities_venue_date_unique` ON `activities` (`livehouse_id`,`date`);--> statement-breakpoint
CREATE TABLE `activity_signups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`activity_id` text NOT NULL,
	`kind` text NOT NULL,
	`player_id` text NOT NULL,
	`band_id` text,
	`creator_id` text,
	`participant_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`band_id`) REFERENCES `bands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_signup_participant_unique` ON `activity_signups` (`activity_id`,`participant_key`);--> statement-breakpoint
CREATE TABLE `band_members` (
	`band_id` text NOT NULL,
	`player_id` text NOT NULL,
	PRIMARY KEY(`band_id`, `player_id`),
	FOREIGN KEY (`band_id`) REFERENCES `bands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `band_members_player_idx` ON `band_members` (`player_id`);--> statement-breakpoint
CREATE TABLE `bands` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`captain_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`captain_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bands_captain_unique` ON `bands` (`captain_id`);
--> statement-breakpoint
CREATE TRIGGER livehouse_activity_detach AFTER DELETE ON livehouses BEGIN
 UPDATE activities SET livehouse_id=NULL WHERE livehouse_id=OLD.id;
END;
