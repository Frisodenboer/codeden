CREATE TABLE `rate_limit_windows` (
	`provider` text NOT NULL,
	`window_id` text NOT NULL,
	`status` text NOT NULL,
	`used_percent` real,
	`resets_at` text,
	`observed_at` text NOT NULL,
	`session_id` text,
	CONSTRAINT `rate_limit_windows_pk` PRIMARY KEY(`provider`, `window_id`)
);
--> statement-breakpoint
CREATE TABLE `usage_ledger` (
	`session_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`project_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`role` text NOT NULL,
	`source` text NOT NULL,
	`automation_id` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`reported_cost_usd` real,
	`ts` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `usage_ledger_pk` PRIMARY KEY(`session_id`, `turn_id`)
);
--> statement-breakpoint
CREATE INDEX `usage_ledger_ts` ON `usage_ledger` (`ts`);--> statement-breakpoint
CREATE INDEX `usage_ledger_project_ts` ON `usage_ledger` (`project_id`,`ts`);