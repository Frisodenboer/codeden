CREATE TABLE `automation_projects` (
	`project_id` text PRIMARY KEY,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `automation_schedules` (
	`automation_id` text NOT NULL,
	`project_id` text NOT NULL,
	`signature` text,
	`next_run_at` text,
	`skip_at` text,
	`paused` integer DEFAULT false NOT NULL,
	`enabled_override` integer,
	`last_fired_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT `automation_schedules_pk` PRIMARY KEY(`automation_id`, `project_id`)
);
--> statement-breakpoint
ALTER TABLE `automations` ADD `work_key` text;