CREATE TABLE `github_sync_state` (
	`project_id` text PRIMARY KEY,
	`etags` text DEFAULT '{}' NOT NULL,
	`since` text,
	`baseline_at` text,
	`last_sync_at` text,
	`last_error` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `github_issues` ADD `body` text;--> statement-breakpoint
ALTER TABLE `github_issues` ADD `comments` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `github_issues` ADD `created_at` text;--> statement-breakpoint
ALTER TABLE `github_issues` ADD `closed_at` text;--> statement-breakpoint
ALTER TABLE `github_prs` ADD `author` text;--> statement-breakpoint
ALTER TABLE `github_prs` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `github_prs` ADD `review_decision` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `github_prs` ADD `reviews` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `github_prs` ADD `mergeable` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `github_prs` ADD `linked_issues` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `github_prs` ADD `commits` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `github_prs` ADD `created_at` text;--> statement-breakpoint
ALTER TABLE `github_prs` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `github_prs` ADD `closed_at` text;--> statement-breakpoint
CREATE INDEX `github_prs_session` ON `github_prs` (`session_id`);--> statement-breakpoint
CREATE INDEX `github_prs_head` ON `github_prs` (`project_id`,`head_branch`);