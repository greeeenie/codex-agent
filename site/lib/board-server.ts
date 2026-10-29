import { env } from 'cloudflare:workers';
import { getDb } from '../db';
import { projects, tasks, settings, taskRuns, taskEvents } from '../db/schema';
import { eq, asc, desc, and, inArray, notInArray, sql,like } from 'drizzle-orm';
import type {SQL} from 'drizzle-orm';
import {projectIdentity} from './project-identity.mjs';
import {PENDING_TASK_TITLE,validateTaskTitle} from './task-title.mjs';
import type { Task, Snapshot, Project, Attachment, Question } from './board-types';
import {interactionReply} from './interaction.mjs';
import {moveTarget} from './board-moves.mjs';
export class BoardError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function checkOrigin(request: Request) { const origin = request.headers.get('origin'); if (origin && origin !== new URL(request.url).origin) throw new BoardError('Недопустимый источник запроса', 403); }
export const taskFromRow = (row: typeof tasks.$inferSelect): Task => ({...row, status: row.status as Task['status'], executionStatus:row.executionStatus as Task['executionStatus'], screenshots: JSON.parse(row.screenshots),question:row.question?JSON.parse(row.question):null,attachments:JSON.parse(row.attachments)});
export async function setting(key: string) { const row = await getDb().select().from(settings).where(eq(settings.key, key)).get(); return row ? JSON.parse(row.value) : null; }
export async function setSetting(key: string, value: unknown) { await getDb().insert(settings).values({key, value: JSON.stringify(value)}).onConflictDoUpdate({target: settings.key, set: {value: JSON.stringify(value)}}); }
export async function snapshot(): Promise<Snapshot> {
  const [p, t, agent, paused,connections] = await Promise.all([getDb().select().from(projects).orderBy(asc(projects.name)), getDb().select().from(tasks).orderBy(asc(tasks.position),asc(tasks.createdAt),asc(tasks.id)), setting('agent'), setting('paused'),getDb().select().from(settings).where(like(settings.key,'agent:%'))]);
  const agents=connections.map(row=>JSON.parse(row.value));return {projects:p.filter(p=>!p.isHidden).map(p=>({...p,available:!!p.isAvailable})), tasks:t.map(taskFromRow), agent,agents, paused:!!paused};
}
export async function taskHistory(id:string){const task=await getTask(id);const [runs,events]=await Promise.all([getDb().select().from(taskRuns).where(eq(taskRuns.taskId,id)).orderBy(desc(taskRuns.startedAt)),getDb().select().from(taskEvents).where(eq(taskEvents.taskId,id)).orderBy(desc(taskEvents.at)).limit(500)]);return {...task,runs,events};}
export async function getTask(id: string) { const row = await getDb().select().from(tasks).where(eq(tasks.id,id)).get(); if (!row) throw new BoardError('Задача не найдена',404); return taskFromRow(row); }
function string(value: unknown, max: number) { if(typeof value!=='string'||value.length>max) throw new BoardError('Проверьте длину текста'); return value.trim(); }
async function taskOptions(input:Record<string,unknown>,previous?:Task,attachments:Attachment[]=previous?.attachments??[]){
 const model=input.model===undefined?previous?.model??null:input.model===null?null:string(input.model,160),effort=input.effort===undefined?previous?.effort??null:input.effort===null?null:string(input.effort,40);
 if(!model&&effort)throw new BoardError('Выберите модель');
 if(model){const agent=await setting('agent'),option=agent?.models?.find((m:{id:string})=>m.id===model);if(!option)throw new BoardError('Выберите доступную модель');if(attachments.some(a=>a.type.startsWith('image/'))&&!option.inputModalities.includes('image'))throw new BoardError('Эта модель не поддерживает изображения');if(effort&&!option.efforts.includes(effort))throw new BoardError('Выберите доступную глубину рассуждения');}
 return {model,effort};
}
export async function createTask(input: Record<string,unknown>,attachments:Attachment[]=[],id=crypto.randomUUID()) {
  const projectId=string(input.projectId,200), description=string(input.description??'',30000),title=input.title===undefined?PENDING_TASK_TITLE:string(input.title,180);
  if(!title||(!description&&title===PENDING_TASK_TITLE)) throw new BoardError('Добавьте описание задачи');
  const project=await getDb().select().from(projects).where(eq(projects.id,projectId)).get();
  if(!project||!project.isAvailable||project.isHidden) throw new BoardError('Проект больше не доступен на доске');
  const options=await taskOptions(input,undefined,attachments);await getDb().insert(tasks).values({id,projectId,title,description,...options,attachments:JSON.stringify(attachments),status:'backlog',position:sql`(SELECT COALESCE(MAX(position),0)+1024 FROM tasks WHERE status='backlog')`,createdAt:Date.now()});return getTask(id);
}
const active=(task:Task)=>task.status==='running'&&['idle','running','waiting'].includes(task.executionStatus)&&!task.finishedAt;
async function guardedUpdate(task:Task,patch:Partial<{[K in keyof typeof tasks.$inferInsert]:(typeof tasks.$inferInsert)[K]|SQL}>){const changed=await getDb().update(tasks).set(patch).where(and(eq(tasks.id,task.id),eq(tasks.status,task.status),sql`${tasks.runId} IS ${task.runId}`,eq(tasks.executionStatus,task.executionStatus))).returning({id:tasks.id});if(!changed.length)throw new BoardError('Состояние задачи изменилось. Обновите доску.',409);}
async function event(task:Task,type:string,text:string,actor='user',id=crypto.randomUUID()){await getDb().insert(taskEvents).values({id,taskId:task.id,runId:task.runId,at:Date.now(),type,actor,text}).onConflictDoNothing();}
export async function reorderTask(id:string,input:Record<string,unknown>){
 const task=await getTask(id);
 const list=await getDb().select({id:tasks.id}).from(tasks).where(eq(tasks.status,task.status)).orderBy(asc(tasks.position),asc(tasks.createdAt),asc(tasks.id));
 const current=list.findIndex(t=>t.id===id),ids=list.map(t=>t.id);ids.splice(current,1);
 let target=ids.length;if(input.direction==='first')target=0;else if(input.direction==='up')target=Math.max(0,current-1);else if(input.direction==='down')target=Math.min(ids.length,current+1);else if(input.beforeId){target=ids.indexOf(String(input.beforeId));if(target<0)throw new BoardError('Целевая карточка уже переместилась',409);}ids.splice(target,0,id);
 await env.DB!.batch([...ids.map((key,index)=>env.DB!.prepare('UPDATE tasks SET position=? WHERE id=? AND status=?').bind((index+1)*1024,key,task.status)),env.DB!.prepare('UPDATE tasks SET activity_at=? WHERE id=? AND status=?').bind(Date.now(),id,task.status)]);
 await event(task,'order','Изменён порядок в '+(task.status==='queued'?'общей очереди':'бэклоге'));return getTask(id);
}
export async function updateTask(id: string,input: Record<string,unknown>,attachments?:Attachment[]) {
  const task=await getTask(id);
  if(input.action==='delete'){
   if(active(task))throw new BoardError('Сначала остановите задачу');
   const predicate='SELECT id FROM tasks WHERE id=? AND status=? AND execution_status=? AND run_id IS ? AND finished_at IS ?';
   const values=[id,task.status,task.executionStatus,task.runId,task.finishedAt];
   const results=await env.DB!.batch([
    env.DB!.prepare(`DELETE FROM task_events WHERE task_id IN (${predicate})`).bind(...values),
    env.DB!.prepare(`DELETE FROM task_runs WHERE task_id IN (${predicate})`).bind(...values),
    env.DB!.prepare(`DELETE FROM tasks WHERE id IN (${predicate})`).bind(...values)
   ]);
   if(!results.at(-1)?.meta.changes)throw new BoardError('Состояние задачи изменилось. Обновите доску.',409);
   const keys=[...task.attachments.map(a=>a.key),...task.screenshots.map(s=>s.key)].filter(key=>key.startsWith(`inputs/${id}/`)||key.startsWith(`${id}/`));
   await Promise.allSettled(keys.map(key=>env.BUCKET?.delete(key)));
   return {...task,deleted:true};
  }
  if(input.action==='reorder')return reorderTask(id,input);
  if(input.action==='duplicate'){
   const copyId=crypto.randomUUID(),copied:Attachment[]=[];
   try{for(const file of task.attachments){const object=await env.BUCKET!.get(file.key);if(!object)throw new BoardError('Не удалось скопировать вложение');const key=`inputs/${copyId}/${crypto.randomUUID()}`;await env.BUCKET!.put(key,object.body,{httpMetadata:{contentType:file.type}});copied.push({...file,key});}return await createTask({projectId:task.projectId,title:task.title,description:task.description,model:task.model,effort:task.effort},copied,copyId);}catch(e){await Promise.allSettled(copied.map(a=>env.BUCKET!.delete(a.key)));throw e;}
  }
  if(input.action==='link'){if(active(task))throw new BoardError('Сначала остановите текущий запуск');const threadId=string(input.threadId,200);if(!/^[a-zA-Z0-9_-]+$/.test(threadId))throw new BoardError('Проверьте ID чата');await guardedUpdate(task,{threadId,lastAction:'Связан чат Codex'});await event(task,'link',threadId);return getTask(id);}
  if(input.action==='archive'||input.action==='unarchive') {
    const from=input.action==='archive'?'done':'archived',to=input.action==='archive'?'archived':'done';
    if(task.status!==from)throw new BoardError(input.action==='archive'?'В архив можно убрать только готовую задачу':'Задача не в архиве');
    const changed=await getDb().update(tasks).set({status:to}).where(and(eq(tasks.id,id),eq(tasks.status,from))).returning({id:tasks.id});
    if(!changed.length)throw new BoardError('Состояние задачи изменилось. Обновите доску.',409);
  } else if(input.action==='stop') {if(!active(task)) throw new BoardError('Задача уже остановлена');const agent=await setting(task.runnerId?`agent:${task.runnerId}`:'agent');await guardedUpdate(task,{stopRequested:1,lastAction:!agent||Date.now()-agent.seenAt>45000?'Остановка ожидает подключения компьютера. Очередь ждёт подтверждения остановки.':'Пользователь запросил остановку'});}
  else if(['restore','retry','revise'].includes(String(input.action))) {
    if(active(task)) throw new BoardError('Сначала остановите задачу');
    if(task.status==='archived')throw new BoardError('Сначала восстановите задачу из архива');
    if(input.action==='revise'&&!String(input.message??'').trim())throw new BoardError('Напишите, что нужно доработать');
    if(input.action==='revise')await event(task,'revision',string(input.message,8000));
    await guardedUpdate(task,{status:input.action==='restore'?'backlog':'queued',position:sql`(SELECT COALESCE(MAX(position),0)+1024 FROM tasks WHERE status=${input.action==='restore'?'backlog':'queued'})`,executionStatus:'idle',lastAction:input.action==='restore'?'Пользователь вернул задачу в бэклог':'Пользователь поставил задачу в очередь',startedAt:null,finishedAt:null,stopRequested:0,runId:null,turnId:null,question:null});
  } else if(input.action==='accept') {
    if(task.status!=='review') throw new BoardError('Задача ещё не на проверке');
    await guardedUpdate(task,{status:'done',finishedAt:Date.now(),lastAction:'Результат принят пользователем'});
  } else if(input.action==='move') {
    if(input.status===task.status)return input.beforeId!==undefined?reorderTask(id,input):task;
    const target=moveTarget(task,String(input.status));if(!target)throw new BoardError(active(task)?'Сначала остановите задачу':'Этот переход недоступен');
    const append=sql`(SELECT COALESCE(MAX(position),0)+1024 FROM tasks WHERE status=${target})`;
    // Save destination and insertion point together, before a runner can claim the task.
    const position=input.beforeId&&target===input.status?sql`COALESCE((SELECT (anchor.position+COALESCE((SELECT MAX(prev.position) FROM tasks prev WHERE prev.status=${target} AND prev.id<>${id} AND prev.position<anchor.position),anchor.position-2048))/2 FROM tasks AS anchor WHERE anchor.id=${String(input.beforeId)} AND anchor.status=${target}),${append})`:append;
    if(target==='done'||target==='review')await guardedUpdate(task,{status:target,activityAt:Date.now(),executionStatus:'completed',lastAction:target==='done'?'Результат принят пользователем':'Результат возвращён на проверку',position});
    else await guardedUpdate(task,{status:target,activityAt:Date.now(),position,executionStatus:'idle',lastAction:'Пользователь переместил задачу',startedAt:null,finishedAt:null,stopRequested:0,runId:null,turnId:null,question:null});
  } else {
    if(task.status==='archived')throw new BoardError('Сначала восстановите задачу из архива');
    const description=string(input.description??task.description,30000),title=input.title===undefined?task.title:string(input.title,180);
    if(!title||(!description&&title===PENDING_TASK_TITLE))throw new BoardError('Добавьте описание задачи');
    await guardedUpdate(task,{title,description,activityAt:Date.now(),...await taskOptions(input,task,attachments??task.attachments),...(attachments?{attachments:JSON.stringify(attachments)}:{})});
    await event(task,'edit',active(task)?'Карточка обновлена. Задание активной попытки сохранено без изменений.':'Карточка обновлена');
  }return getTask(id);
}
export async function pendingTaskTitles(projectIds:string[]){
 if(!projectIds.length)return [];
 return getDb().select({id:tasks.id,description:tasks.description}).from(tasks).innerJoin(projects,eq(tasks.projectId,projects.id)).where(and(eq(tasks.title,PENDING_TASK_TITLE),inArray(tasks.projectId,projectIds),eq(projects.isAvailable,1),eq(projects.isHidden,0),notInArray(tasks.status,['archived']))).orderBy(asc(tasks.createdAt)).limit(5);
}
export async function saveGeneratedTaskTitle(id:string,description:string,value:string,fallback=false){
 let title;try{title=fallback?(description.trim().split(/\r?\n/)[0].slice(0,77).trim()||'Новая задача'):validateTaskTitle(value,description);}catch{throw new BoardError('Не удалось сформировать название');}
 const changed=await getDb().update(tasks).set({title}).where(and(eq(tasks.id,id),eq(tasks.description,description),eq(tasks.title,PENDING_TASK_TITLE))).returning({id:tasks.id});
 return {updated:changed.length>0};
}
export async function claimTask(projectIds?: string[],capabilities:string[]=[],runnerId='mcp') {
  if(await setting('paused'))return null;
  if(projectIds&&!projectIds.length)return null;
  const filter=projectIds?.length?` AND t.project_id IN (${projectIds.map(()=>'?').join(',')})`:'';
  if(!capabilities.includes('workflow-v2'))return null;
  const compatible=capabilities.includes('task-input-v1')?'':" AND t.model IS NULL AND t.effort IS NULL AND t.attachments='[]'";
  // The availability check and claim share one SQLite write, across all projects and agents.
  const row=await env.DB!.prepare(`UPDATE tasks SET question=NULL,status='running',execution_status='running',result='',last_action='Запуск Codex',activity_at=?,started_at=?,finished_at=NULL,stop_requested=0,run_id=?,runner_id=? WHERE id=(SELECT t.id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.status='queued' AND p.is_hidden=0 ORDER BY t.position,t.created_at,t.id LIMIT 1) AND status='queued' AND id IN (SELECT t.id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.is_available=1 AND p.is_hidden=0${filter}${compatible}) AND NOT EXISTS(SELECT 1 FROM tasks WHERE status='running' AND execution_status IN ('idle','running','waiting') AND finished_at IS NULL) AND NOT EXISTS(SELECT 1 FROM settings WHERE key='paused' AND value='true') RETURNING id`).bind(Date.now(),Date.now(),crypto.randomUUID(),runnerId,...(projectIds??[])).first<{id:string}>();
  return row?getTask(row.id):null;
}
export async function reportTask(id: string,input: Record<string,unknown>) {
  const task=await getTask(id);if(input.runId!==task.runId)throw new BoardError('Этот запуск уже завершён',409);
  if(!active(task))return task; // A lost HTTP response can be retried without blocking delivery.
  const patch: Partial<typeof tasks.$inferInsert>={};
  if(input.threadId)patch.threadId=string(input.threadId,200);
  if(input.turnId)patch.turnId=string(input.turnId,200);
  if(input.status!==undefined){
   const value=String(input.status);if(!['backlog','review','done','error','stopped','waiting'].includes(value))throw new BoardError('Недопустимый статус');
   patch.status=['review','done'].includes(value)?'review':'running';patch.executionStatus=['review','done'].includes(value)?'completed':value==='backlog'?'error':value;
   patch.finishedAt=Date.now();patch.result=string(input.result??'',12000);patch.lastAction=patch.result||'Попытка завершена';patch.activityAt=Date.now();
   if(task.question)patch.question=['review','done'].includes(value)?null:JSON.stringify({...task.question,live:false});
  }
  if(Object.keys(patch).length){const changed=await getDb().update(tasks).set(patch).where(and(eq(tasks.id,id),eq(tasks.status,'running'),eq(tasks.runId,String(input.runId)),sql`${tasks.finishedAt} IS NULL`)).returning({id:tasks.id});if(!changed.length){const latest=await getTask(id);if(latest.runId!==input.runId)throw new BoardError('Этот запуск уже завершён',409);}}
  return getTask(id);
}
export async function recordRunEvent(id:string,runId:string,eventId:string,type:string,text:string){
 const task=await getTask(id);if(task.runId!==runId||!active(task))throw new BoardError('Этот запуск уже завершён',409);
 const statements=[env.DB!.prepare("INSERT OR IGNORE INTO task_events(id,task_id,run_id,at,type,actor,text) SELECT ?,id,run_id,?,?, 'agent',? FROM tasks WHERE id=? AND run_id=? AND status='running' AND finished_at IS NULL").bind(eventId,Date.now(),type,text,id,runId)];
 if(type==='activity')statements.push(env.DB!.prepare("UPDATE tasks SET activity_at=?,last_action=? WHERE id=? AND run_id=? AND finished_at IS NULL").bind(Date.now(),text,id,runId));
 if(type==='question-resolved')statements.push(env.DB!.prepare("UPDATE tasks SET execution_status='running',last_action=CASE WHEN json_extract(question,'$.answer') IS NULL THEN 'Запрос закрыт Codex' ELSE 'Ответ передан Codex' END,question=NULL,activity_at=? WHERE id=? AND run_id=? AND finished_at IS NULL AND json_extract(question,'$.id')=?").bind(Date.now(),id,runId,text));
 await env.DB!.batch(statements);return {ok:true};
}
export async function sendTaskMessage(id:string,text:string){const task=await getTask(id);if(!active(task))throw new BoardError('Сейчас нет активного запуска');text=string(text,8000);if(!text)throw new BoardError('Введите уточнение');await event(task,'message',text);return getTask(id);}
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
export async function syncAgent(runnerId:string|undefined,list:Project[],agent:unknown,capabilities:string[]=[]){
 const value={...(agent as object),runnerId,capabilities,seenAt:Date.now()};await setSetting('agent',value);
 if(!runnerId){await syncProjects(list);return;}
 await setSetting(`agent:${runnerId}`,value);await setSetting(`projects:${runnerId}`,list);
 const rows=await getDb().select().from(settings).where(like(settings.key,'agent:%'));
 const catalogs=await Promise.all(rows.filter(row=>Date.now()-JSON.parse(row.value).seenAt<90000).map(row=>setting(`projects:${row.key.slice(6)}`)));
 const merged=new Map<string,Project>();for(const catalog of catalogs)for(const project of catalog??[])merged.set(project.id,project);await syncProjects([...merged.values()]);
}
export async function setProjectHidden(id:string,hidden:boolean){
  const project=await getDb().select().from(projects).where(eq(projects.id,id)).get();
  if(!project)throw new BoardError('Проект не найден',404);
  if(hidden&&await getDb().select({id:tasks.id}).from(tasks).where(and(eq(tasks.projectId,id),eq(tasks.status,'running'))).get())throw new BoardError('Сначала остановите задачу этого проекта');
  if(!hidden&&!project.isAvailable)throw new BoardError('Сначала добавьте проект в Codex');
  await getDb().update(projects).set({isHidden:hidden?1:0}).where(eq(projects.id,id));return {ok:true};
}
export async function askQuestion(id:string,runId:string,question:Omit<Question,'answer'>){
  const task=await getTask(id);
  if(!active(task)||task.runId!==runId||task.stopRequested)throw new BoardError('Этот запуск уже остановлен',409);
  if(task.question?.id===question.id)return task;
  if(task.question&&!task.question.answer)throw new BoardError('Сначала ответьте на предыдущий вопрос',409);
  const result=await env.DB!.prepare("UPDATE tasks SET question=?,execution_status='waiting',activity_at=?,last_action=? WHERE id=? AND status='running' AND run_id=? AND stop_requested=0 AND finished_at IS NULL AND question IS ?").bind(JSON.stringify({...question,answer:null}),Date.now(),question.prompt,id,runId,task.question?JSON.stringify(task.question):null).run();
  if(!result.meta.changes)throw new BoardError('Состояние задачи изменилось',409);
  await event(task,'question',JSON.stringify(question),'agent',`${runId}:question:${question.id}`);return getTask(id);
}
export async function answerQuestion(id:string,questionId:string,answer:string){
  const task=await getTask(id);answer=string(answer,16000);
  if(!answer)throw new BoardError('Введите ответ');
  if(!active(task)||task.stopRequested||!task.question||task.question.id!==questionId||task.question.answer!==null||task.question.live===false)throw new BoardError('Живой запрос уже закрыт. Продолжите с сохранённым контекстом.',409);
  if(task.question.method){try{interactionReply(task.question,answer);}catch(e){throw new BoardError(e instanceof Error?e.message:'Проверьте ответ');}}
  const result=await env.DB!.prepare("UPDATE tasks SET question=? WHERE id=? AND status='running' AND run_id=? AND stop_requested=0 AND finished_at IS NULL AND question=?").bind(JSON.stringify({...task.question,answer,answeredAt:Date.now()}),id,task.runId,JSON.stringify(task.question)).run();
  if(!result.meta.changes)throw new BoardError('Вопрос уже закрыт',409);
  await event(task,'answer',answer,'user',`${task.runId}:answer:${questionId}`);return getTask(id);
}
export async function importThread(input:Record<string,unknown>){
 const projectId=string(input.projectId,200),threadId=string(input.threadId,200);
 const existing=await getDb().select().from(tasks).where(and(eq(tasks.projectId,projectId),eq(tasks.threadId,threadId))).get();if(existing)return getTask(existing.id);
 const cached=await setting(`threads:${projectId}`);const match=cached?.threads?.find((t:{id:string})=>t.id===threadId);if(!match)throw new BoardError('Чат отсутствует в списке выбранного проекта. Можно связать его по ID в карточке.');
 // Deterministic identity makes two simultaneous imports converge without launching work.
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`chat:${projectId}:${threadId}`)))).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,32),id=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;
 try{const task=await createTask({projectId,title:match.title||'Чат Codex',description:'Импортированный чат Codex'},[],id);await guardedUpdate(task,{threadId});return getTask(id);}catch(e){const row=await getDb().select().from(tasks).where(eq(tasks.id,id)).get();if(row)return getTask(id);throw e;}
}
