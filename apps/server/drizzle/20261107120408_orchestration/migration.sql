CREATE TABLE `conflicts` (
	`id` text PRIMARY KEY,
	`project_id` text,
	`record` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notices` (
	`id` text PRIMARY KEY,
	`type` text NOT NULL,
	`target` text NOT NULL,
	`project_id` text,
	`session_id` text,
	`notice` text NOT NULL,
	`created_at` text NOT NULL,
	`delivered_at` text
);
--> statement-breakpoint
CREATE INDEX `conflicts_project` ON `conflicts` (`project_id`);--> statement-breakpoint
CREATE INDEX `notices_target` ON `notices` (`target`,`project_id`,`delivered_at`);--> statement-breakpoint
CREATE INDEX `notices_created` ON `notices` (`created_at`);