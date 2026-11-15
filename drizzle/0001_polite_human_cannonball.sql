CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`bio` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE `shops` ADD `owner_id` text;