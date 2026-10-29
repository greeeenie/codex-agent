ALTER TABLE `projects` ADD `is_available` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `is_hidden` integer DEFAULT 0 NOT NULL;