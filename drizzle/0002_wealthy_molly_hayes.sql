CREATE TABLE `entity_images` (
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	PRIMARY KEY(`entity_type`, `entity_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_images_object_key_unique` ON `entity_images` (`object_key`);