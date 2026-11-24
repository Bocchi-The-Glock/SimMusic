DROP INDEX `activity_signup_participant_unique`;
--> statement-breakpoint
CREATE INDEX `activity_signup_participant_idx` ON `activity_signups` (`activity_id`,`participant_key`);
