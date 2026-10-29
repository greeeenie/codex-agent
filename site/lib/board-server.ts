import { env } from 'cloudflare:workers';
import { getDb } from '../db';
import { projects, tasks, settings } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import type { Task, Snapshot, Project } from './board-types';
export class BoardError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function checkOrigin(request: Request) { const origin = request.headers.get('origin'); if (origin && origin !== new URL(request.url).origin) throw new BoardError('Недопустимый источник запроса', 403); }
export const taskFromRow = (row: typeof tasks.$inferSelect): Task => ({...row, status: (row.status==='review'?'backlog':row.status) as Task['status'], screenshots: JSON.parse(row.screenshots)});
export async function setting(key: string) { const row = await getDb().select().from(settings).where(eq(settings.key, key)).get(); return row ? JSON.parse(row.value) : null; }
export async function setSetting(key: string, value: unknown) { await getDb().insert(settings).values({key, value: JSON.stringify(value)}).onConflictDoUpdate({target: settings.key, set: {value: JSON.stringify(value)}}); }
export async function snapshot(): Promise<Snapshot> {
  const [p, t, agent, paused] = await Promise.all([getDb().select().from(projects).orderBy(asc(projects.name)), getDb().select().from(tasks).orderBy(asc(tasks.createdAt)), setting('agent'), setting('paused')]);
  return {projects:p, tasks:t.map(taskFromRow), agent, paused:!!paused};
}
export async function getTask(id: string) { const row = await getDb().select().from(tasks).where(eq(tasks.id,id)).get(); if (!row) throw new BoardError('Задача не найдена',404); return taskFromRow(row); }
function string(value: unknown, max: number) { if(typeof value!=='string'||value.length>max) throw new BoardError('Проверьте длину текста'); return value.trim(); }
export async function createTask(input: Record<string,unknown>) {
  const projectId=string(input.projectId,200), title=string(input.title,180), description=string(input.description??'',30000);
  if(!title) throw new BoardError('Добавьте название задачи');
  if(!await getDb().select().from(projects).where(eq(projects.id,projectId)).get()) throw new BoardError('Проект не найден');
  const id=crypto.randomUUID();await getDb().insert(tasks).values({id,projectId,title,description,status:'backlog',createdAt:Date.now()});return getTask(id);
}
export async function updateTask(id: string,input: Record<string,unknown>) {
  const task=await getTask(id);
  if(input.action==='stop') {if(task.status!=='running') throw new BoardError('Задача уже остановлена');await getDb().update(tasks).set({stopRequested:1}).where(eq(tasks.id,id));}
  else if(input.action==='restore') {
    if(task.status==='running') throw new BoardError('Сначала остановите задачу');
    await getDb().update(tasks).set({status:'backlog',startedAt:null,finishedAt:null,stopRequested:0,runId:null,turnId:null}).where(eq(tasks.id,id));
  } else if(input.action==='accept') {
    if(task.status!=='done') throw new BoardError('Задача ещё не завершена');
    await getDb().update(tasks).set({status:'done',finishedAt:Date.now()}).where(eq(tasks.id,id));
  } else if(input.action==='move') {
    if(!({backlog:['queued'],queued:['backlog'],done:['backlog']} as Record<string,string[]>)[task.status]?.includes(String(input.status))) throw new BoardError('Этот переход недоступен');
    await getDb().update(tasks).set({status:String(input.status),startedAt:null,finishedAt:null,stopRequested:0,runId:null,turnId:null}).where(eq(tasks.id,id));
  } else {
    if(!['backlog','queued'].includes(task.status)) throw new BoardError('Сначала верните задачу в Backlog');
    const title=string(input.title,180);if(!title) throw new BoardError('Добавьте название');
    await getDb().update(tasks).set({title,description:string(input.description??'',30000)}).where(eq(tasks.id,id));
  }return getTask(id);
}
export async function claimTask(projectIds?: string[]) {
  if(await setting('paused'))return null;
  if(projectIds&&!projectIds.length)return null;
  const filter=projectIds?.length?` AND project_id IN (${projectIds.map(()=>'?').join(',')})`:'';
  const row=await env.DB!.prepare(`UPDATE tasks SET status='running',started_at=?,finished_at=NULL,stop_requested=0,run_id=? WHERE id=(SELECT id FROM tasks WHERE status='queued'${filter} ORDER BY created_at LIMIT 1) AND status='queued' RETURNING id`).bind(Date.now(),crypto.randomUUID(),...(projectIds??[])).first<{id:string}>();
  return row?getTask(row.id):null;
}
export async function reportTask(id: string,input: Record<string,unknown>) {
  const task=await getTask(id);if(task.status!=='running'||input.runId!==task.runId)throw new BoardError('Этот запуск уже завершён',409);
  const patch: Partial<typeof tasks.$inferInsert>={};
  if(input.threadId)patch.threadId=string(input.threadId,200);
  if(input.turnId)patch.turnId=string(input.turnId,200);
  if(input.status!==undefined){if(!['backlog','review','done'].includes(String(input.status)))throw new BoardError('Недопустимый статус');patch.status=input.status==='review'?'backlog':String(input.status);patch.finishedAt=Date.now();patch.result=string(input.result??'',12000);}
  if(Object.keys(patch).length)await getDb().update(tasks).set(patch).where(eq(tasks.id,id));return getTask(id);
}
export async function syncProjects(list: Project[]) {
  if(!Array.isArray(list)||list.length>100)throw new BoardError('Некорректный список проектов');
  for(const p of list){const value={id:string(p.id,200),name:string(p.name,120),path:string(p.path,1000),host:string(p.host??'local',200)};
    await getDb().insert(projects).values(value).onConflictDoUpdate({target:projects.id,set:value});}
}
