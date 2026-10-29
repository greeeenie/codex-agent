import { env } from 'cloudflare:workers';
import { getDb } from '../db';
import { projects, tasks, settings } from '../db/schema';
import { eq, asc, and, notInArray } from 'drizzle-orm';
import {projectIdentity} from './project-identity.mjs';
import type { Task, Snapshot, Project } from './board-types';
export class BoardError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function checkOrigin(request: Request) { const origin = request.headers.get('origin'); if (origin && origin !== new URL(request.url).origin) throw new BoardError('Недопустимый источник запроса', 403); }
export const taskFromRow = (row: typeof tasks.$inferSelect): Task => ({...row, status: (row.status==='review'?'backlog':row.status) as Task['status'], screenshots: JSON.parse(row.screenshots),question:row.question?JSON.parse(row.question):null});
export async function setting(key: string) { const row = await getDb().select().from(settings).where(eq(settings.key, key)).get(); return row ? JSON.parse(row.value) : null; }
export async function setSetting(key: string, value: unknown) { await getDb().insert(settings).values({key, value: JSON.stringify(value)}).onConflictDoUpdate({target: settings.key, set: {value: JSON.stringify(value)}}); }
export async function snapshot(): Promise<Snapshot> {
  const [p, t, agent, paused] = await Promise.all([getDb().select().from(projects).orderBy(asc(projects.name)), getDb().select().from(tasks).orderBy(asc(tasks.createdAt)), setting('agent'), setting('paused')]);
  return {projects:p.filter(p=>p.isAvailable&&!p.isHidden), tasks:t.map(taskFromRow), agent, paused:!!paused};
}
export async function getTask(id: string) { const row = await getDb().select().from(tasks).where(eq(tasks.id,id)).get(); if (!row) throw new BoardError('Задача не найдена',404); return taskFromRow(row); }
function string(value: unknown, max: number) { if(typeof value!=='string'||value.length>max) throw new BoardError('Проверьте длину текста'); return value.trim(); }
export async function createTask(input: Record<string,unknown>) {
  const projectId=string(input.projectId,200), title=string(input.title,180), description=string(input.description??'',30000);
  if(!title) throw new BoardError('Добавьте название задачи');
  const project=await getDb().select().from(projects).where(eq(projects.id,projectId)).get();
  if(!project||!project.isAvailable||project.isHidden) throw new BoardError('Проект больше не доступен на доске');
  const id=crypto.randomUUID();await getDb().insert(tasks).values({id,projectId,title,description,status:'backlog',createdAt:Date.now()});return getTask(id);
}
export async function updateTask(id: string,input: Record<string,unknown>) {
  const task=await getTask(id);
  if(input.action==='stop') {if(task.status!=='running') throw new BoardError('Задача уже остановлена');await getDb().update(tasks).set({stopRequested:1}).where(eq(tasks.id,id));}
  else if(input.action==='restore') {
    if(task.status==='running') throw new BoardError('Сначала остановите задачу');
    await getDb().update(tasks).set({status:'backlog',startedAt:null,finishedAt:null,stopRequested:0,runId:null,turnId:null,question:null}).where(eq(tasks.id,id));
  } else if(input.action==='accept') {
    if(task.status!=='done') throw new BoardError('Задача ещё не завершена');
    await getDb().update(tasks).set({status:'done',finishedAt:Date.now()}).where(eq(tasks.id,id));
  } else if(input.action==='move') {
    if(!({backlog:['queued'],queued:['backlog'],done:['backlog']} as Record<string,string[]>)[task.status]?.includes(String(input.status))) throw new BoardError('Этот переход недоступен');
    await getDb().update(tasks).set({status:String(input.status),startedAt:null,finishedAt:null,stopRequested:0,runId:null,turnId:null,question:null}).where(eq(tasks.id,id));
  } else {
    if(!['backlog','queued'].includes(task.status)) throw new BoardError('Сначала верните задачу в Backlog');
    const title=string(input.title,180);if(!title) throw new BoardError('Добавьте название');
    await getDb().update(tasks).set({title,description:string(input.description??'',30000)}).where(eq(tasks.id,id));
  }return getTask(id);
}
export async function claimTask(projectIds?: string[]) {
  if(await setting('paused'))return null;
  if(projectIds&&!projectIds.length)return null;
  const filter=projectIds?.length?` AND t.project_id IN (${projectIds.map(()=>'?').join(',')})`:'';
  const row=await env.DB!.prepare(`UPDATE tasks SET question=NULL,status='running',started_at=?,finished_at=NULL,stop_requested=0,run_id=? WHERE id=(SELECT t.id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.status='queued' AND p.is_available=1 AND p.is_hidden=0${filter} ORDER BY t.created_at LIMIT 1) AND status='queued' RETURNING id`).bind(Date.now(),crypto.randomUUID(),...(projectIds??[])).first<{id:string}>();
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
  let existing=await getDb().select().from(projects);
  for(const p of list){const value={id:string(p.id,200),name:string(p.name,120),path:string(p.path,1000),host:string(p.host??'local',200)};
    const matches=existing.filter(row=>row.id===value.id||projectIdentity(row)===projectIdentity(value));
    const duplicates=matches.filter(row=>row.id!==value.id).map(row=>row.id);
    const next={...value,isAvailable:1,isHidden:matches.some(row=>row.isHidden)?1:0};
    if(duplicates.length){
      const placeholders=duplicates.map(()=>'?').join(',');
      // Preserve every task and its run/context before removing duplicate rows.
      await env.DB!.batch([
        env.DB!.prepare('INSERT INTO projects (id,name,path,host,is_available,is_hidden) VALUES (?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,path=excluded.path,host=excluded.host,is_available=1,is_hidden=excluded.is_hidden').bind(next.id,next.name,next.path,next.host,next.isHidden),
        env.DB!.prepare(`UPDATE tasks SET project_id=? WHERE project_id IN (${placeholders})`).bind(next.id,...duplicates),
        env.DB!.prepare(`DELETE FROM projects WHERE id IN (${placeholders})`).bind(...duplicates),
      ]);
    }else await getDb().insert(projects).values(next).onConflictDoUpdate({target:projects.id,set:next});
    existing=[...existing.filter(row=>!duplicates.includes(row.id)&&row.id!==next.id),next];
  }
  const hosts=list.length?[...new Set(list.map(p=>p.host??'local'))]:['local'];
  for(const host of hosts){const ids=list.filter(p=>(p.host??'local')===host).map(p=>p.id);
    await getDb().update(projects).set({isAvailable:0}).where(ids.length?and(eq(projects.host,host),notInArray(projects.id,ids)):eq(projects.host,host));
  }
}
export async function setProjectHidden(id:string,hidden:boolean){
  const project=await getDb().select().from(projects).where(eq(projects.id,id)).get();
  if(!project)throw new BoardError('Проект не найден',404);
  if(hidden&&await getDb().select({id:tasks.id}).from(tasks).where(and(eq(tasks.projectId,id),eq(tasks.status,'running'))).get())throw new BoardError('Сначала остановите задачу этого проекта');
  if(!hidden&&!project.isAvailable)throw new BoardError('Сначала добавьте проект в Codex');
  await getDb().update(projects).set({isHidden:hidden?1:0}).where(eq(projects.id,id));return {ok:true};
}
export async function askQuestion(id:string,runId:string,question:{id:string;prompt:string}){
  const task=await getTask(id);
  if(task.status!=='running'||task.runId!==runId||task.stopRequested)throw new BoardError('Этот запуск уже остановлен',409);
  if(task.question?.id===question.id)return task;
  if(task.question&&!task.question.answer)throw new BoardError('Сначала ответьте на предыдущий вопрос',409);
  const result=await env.DB!.prepare("UPDATE tasks SET question=? WHERE id=? AND status='running' AND run_id=? AND stop_requested=0 AND question IS ?").bind(JSON.stringify({...question,answer:null}),id,runId,task.question?JSON.stringify(task.question):null).run();
  if(!result.meta.changes)throw new BoardError('Состояние задачи изменилось',409);
  return getTask(id);
}
export async function answerQuestion(id:string,questionId:string,answer:string){
  const task=await getTask(id);answer=string(answer,8000);
  if(!answer)throw new BoardError('Введите ответ');
  if(task.status!=='running'||task.stopRequested||!task.question||task.question.id!==questionId||task.question.answer!==null)throw new BoardError('Вопрос уже закрыт',409);
  const result=await env.DB!.prepare("UPDATE tasks SET question=? WHERE id=? AND status='running' AND run_id=? AND stop_requested=0 AND question=?").bind(JSON.stringify({...task.question,answer}),id,task.runId,JSON.stringify(task.question)).run();
  if(!result.meta.changes)throw new BoardError('Вопрос уже закрыт',409);
  return getTask(id);
}
