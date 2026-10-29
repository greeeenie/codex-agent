CREATE TABLE `task_events` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`run_id` text,
	`at` integer NOT NULL,
	`type` text NOT NULL,
	`actor` text NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`input` text NOT NULL,
	`thread_id` text,
	`turn_id` text,
	`result` text DEFAULT '' NOT NULL,
	`runner_id` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `execution_status` text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `activity_at` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `last_action` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `runner_id` text;
--> statement-breakpoint
CREATE INDEX tasks_queue_order ON tasks(status,position,id);
--> statement-breakpoint
CREATE INDEX task_events_history ON task_events(task_id,at);
--> statement-breakpoint
CREATE TRIGGER task_run_started AFTER UPDATE OF run_id ON tasks WHEN NEW.run_id IS NOT NULL AND NEW.run_id IS NOT OLD.run_id BEGIN
 INSERT INTO task_runs(id,task_id,status,started_at,input,thread_id,runner_id) VALUES(NEW.run_id,NEW.id,NEW.execution_status,NEW.started_at,json_object('title',NEW.title,'description',NEW.description,'model',NEW.model,'effort',NEW.effort,'attachments',json(NEW.attachments)),NEW.thread_id,NEW.runner_id);
END;
--> statement-breakpoint
CREATE TRIGGER task_run_updated AFTER UPDATE ON tasks WHEN NEW.run_id IS NOT NULL BEGIN
 UPDATE task_runs SET status=NEW.execution_status,finished_at=NEW.finished_at,thread_id=NEW.thread_id,turn_id=NEW.turn_id,result=NEW.result WHERE id=NEW.run_id;
END;
--> statement-breakpoint
CREATE TRIGGER task_transition AFTER UPDATE ON tasks WHEN NEW.status IS NOT OLD.status OR NEW.execution_status IS NOT OLD.execution_status OR NEW.stop_requested IS NOT OLD.stop_requested BEGIN
 INSERT INTO task_events(id,task_id,run_id,at,type,actor,text) VALUES(lower(hex(randomblob(16))),NEW.id,NEW.run_id,CAST(unixepoch('subsec')*1000 AS INTEGER),'transition',CASE WHEN NEW.run_id IS NOT NULL AND (NEW.execution_status IS NOT OLD.execution_status OR NEW.status='review') THEN 'agent' ELSE 'user' END,json_object('from',OLD.status,'to',NEW.status,'execution',NEW.execution_status,'stopRequested',NEW.stop_requested,'reason',NEW.last_action));
END;
