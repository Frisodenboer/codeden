CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`media_type` text NOT NULL,
	`path` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text,
	`project_id` text,
	`session_id` text,
	`thread_id` text,
	`item_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY,
	`automation_id` text NOT NULL,
	`project_id` text,
	`status` text NOT NULL,
	`triggered_by` text NOT NULL,
	`started_by` text NOT NULL,
	`purpose` text NOT NULL,
	`work_key` text NOT NULL,
	`scope` text NOT NULL,
	`progress` text,
	`skip_reason` text,
	`session_id` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT false NOT NULL,
	`source` text NOT NULL,
	`template_id` text,
	`trigger` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`guards` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT,
	`session_id` text,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`ts` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `github_issues` (
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`url` text NOT NULL,
	`labels` text NOT NULL,
	`author` text,
	`etag` text,
	`updated_at` text NOT NULL,
	`synced_at` text NOT NULL,
	CONSTRAINT `github_issues_pk` PRIMARY KEY(`project_id`, `number`)
);
--> statement-breakpoint
CREATE TABLE `github_prs` (
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`url` text NOT NULL,
	`head_branch` text NOT NULL,
	`base_branch` text NOT NULL,
	`checks` text,
	`session_id` text,
	`etag` text,
	`updated_at` text NOT NULL,
	`synced_at` text NOT NULL,
	CONSTRAINT `github_prs_pk` PRIMARY KEY(`project_id`, `number`)
);
--> statement-breakpoint
CREATE TABLE `inbox_items` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`project_id` text,
	`session_id` text,
	`thread_id` text,
	`item_id` text,
	`request_id` text,
	`issue` text,
	`pr` text,
	`automation_run_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`resolved_at` text,
	`resolution` text
);
--> statement-breakpoint
CREATE TABLE `items` (
	`session_id` text NOT NULL,
	`id` text NOT NULL,
	`thread_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `items_pk` PRIMARY KEY(`session_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`path` text NOT NULL,
	`default_branch` text,
	`default_provider` text,
	`autonomy` text,
	`autonomy_mode` text DEFAULT 'assisted' NOT NULL,
	`vision_path` text DEFAULT '.codeden/VISION.md' NOT NULL,
	`factory_limits` text,
	`kill_switch` integer DEFAULT false NOT NULL,
	`timezone` text,
	`github` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE TABLE `runner_state` (
	`runner_id` text PRIMARY KEY,
	`last_acked_seq` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`project_id` text,
	`role` text NOT NULL,
	`parent_session_id` text,
	`started_by` text NOT NULL,
	`purpose` text NOT NULL,
	`work_key` text NOT NULL,
	`scope` text NOT NULL,
	`progress` text,
	`title` text,
	`provider` text NOT NULL,
	`model` text,
	`effort` text,
	`autonomy` text NOT NULL,
	`status` text NOT NULL,
	`cwd` text NOT NULL,
	`worktree_path` text,
	`branch` text,
	`base_branch` text,
	`issue` text,
	`pr` text,
	`resume_token` text,
	`runner_id` text,
	`automation_run_id` text,
	`root_thread_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`ended_at` text
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`session_id` text NOT NULL,
	`id` text NOT NULL,
	`parent_thread_id` text,
	`parent_item_id` text,
	`title` text,
	`agent_type` text,
	`created_at` text NOT NULL,
	CONSTRAINT `threads_pk` PRIMARY KEY(`session_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `turns` (
	`session_id` text NOT NULL,
	`id` text NOT NULL,
	`thread_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`error` text,
	CONSTRAINT `turns_pk` PRIMARY KEY(`session_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `automation_runs_automation` ON `automation_runs` (`automation_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `automation_runs_work_key` ON `automation_runs` (`project_id`,`work_key`);--> statement-breakpoint
CREATE INDEX `events_session_seq` ON `events` (`session_id`,`seq`);--> statement-breakpoint
CREATE INDEX `events_type` ON `events` (`type`);--> statement-breakpoint
CREATE INDEX `inbox_status` ON `inbox_items` (`status`);--> statement-breakpoint
CREATE INDEX `items_thread` ON `items` (`session_id`,`thread_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug` ON `projects` (`slug`);--> statement-breakpoint
CREATE INDEX `sessions_project` ON `sessions` (`project_id`);--> statement-breakpoint
CREATE INDEX `sessions_status` ON `sessions` (`status`);--> statement-breakpoint
CREATE INDEX `sessions_work_key` ON `sessions` (`project_id`,`work_key`);