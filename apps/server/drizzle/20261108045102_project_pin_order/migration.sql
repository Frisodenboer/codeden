ALTER TABLE `projects` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill: number the existing projects in the order they were listed before (by name), so nothing moves on upgrade.
UPDATE `projects` SET `sort_order` = (SELECT COUNT(*) FROM `projects` AS `p` WHERE `p`.`name` < `projects`.`name` OR (`p`.`name` = `projects`.`name` AND `p`.`id` < `projects`.`id`));
