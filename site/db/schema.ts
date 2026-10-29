import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(), name: text('name').notNull(), path: text('path').notNull(), host: text('host').notNull().default('local'),
  isAvailable: integer('is_available').notNull().default(1), isHidden: integer('is_hidden').notNull().default(0),
});
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id),
  title: text('title').notNull(), description: text('description').notNull().default(''),
  status: text('status').notNull().default('queued'), result: text('result').notNull().default(''),
  position: integer('position').notNull().default(0), executionStatus: text('execution_status').notNull().default('idle'),
  activityAt: integer('activity_at'), lastAction: text('last_action').notNull().default(''), runnerId: text('runner_id'),
  createdAt: integer('created_at').notNull(), startedAt: integer('started_at'), finishedAt: integer('finished_at'),
  threadId: text('thread_id'), turnId: text('turn_id'), runId: text('run_id'),
  question: text('question'),
  model: text('model'), effort: text('effort'), attachments: text('attachments').notNull().default('[]'),
  screenshots: text('screenshots').notNull().default('[]'), stopRequested: integer('stop_requested').notNull().default(0),
});
export const settings = sqliteTable('settings', { key: text('key').primaryKey(), value: text('value').notNull() });
export const taskRuns = sqliteTable('task_runs', {
  id:text('id').primaryKey(), taskId:text('task_id').notNull().references(()=>tasks.id), status:text('status').notNull(),
  startedAt:integer('started_at').notNull(), finishedAt:integer('finished_at'), input:text('input').notNull(),
  threadId:text('thread_id'), turnId:text('turn_id'), result:text('result').notNull().default(''), runnerId:text('runner_id'),
});
export const taskEvents = sqliteTable('task_events', {
  id:text('id').primaryKey(), taskId:text('task_id').notNull().references(()=>tasks.id), runId:text('run_id'),
  at:integer('at').notNull(), type:text('type').notNull(), actor:text('actor').notNull(), text:text('text').notNull(),
});
