CREATE TABLE `factory_digests` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`day` text NOT NULL,
	`digest` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `factory_items` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`stage` text NOT NULL,
	`work_key` text NOT NULL,
	`item` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `factory_loops` (
	`project_id` text PRIMARY KEY,
	`state` text NOT NULL,
	`loop` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `factory_digests_project` ON `factory_digests` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `factory_items_project_stage` ON `factory_items` (`project_id`,`stage`);--> statement-breakpoint
CREATE INDEX `factory_items_updated` ON `factory_items` (`project_id`,`updated_at`);