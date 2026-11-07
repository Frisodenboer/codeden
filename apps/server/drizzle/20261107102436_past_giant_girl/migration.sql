CREATE TABLE `checkpoints` (
	`session_id` text NOT NULL,
	`idx` integer NOT NULL,
	`ref` text NOT NULL,
	`commit_sha` text NOT NULL,
	`turn_id` text,
	`created_at` text NOT NULL,
	CONSTRAINT `checkpoints_pk` PRIMARY KEY(`session_id`, `idx`)
);
--> statement-breakpoint
CREATE TABLE `mcp_tokens` (
	`id` text PRIMARY KEY,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`session_id` text NOT NULL,
	`project_id` text,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE TABLE `queued_messages` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`input` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `result` text;--> statement-breakpoint
CREATE INDEX `checkpoints_turn` ON `checkpoints` (`session_id`,`turn_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tokens_hash` ON `mcp_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mcp_tokens_session` ON `mcp_tokens` (`session_id`);--> statement-breakpoint
CREATE INDEX `queued_messages_session` ON `queued_messages` (`session_id`,`created_at`);