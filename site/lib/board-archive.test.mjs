import test, {beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {drizzle} from 'drizzle-orm/sqlite-proxy';
import ts from 'typescript';

// Load the production server with an isolated SQLite database instead of Worker bindings.
const root=new URL('../',import.meta.url);
registerHooks({
 resolve(specifier,context,next){
  if(context.parentURL===new URL('lib/board-server.ts',root).href){
   if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env={get DB(){return globalThis.__archiveD1}}',shortCircuit:true};
   if(specifier==='../db')return {url:'data:text/javascript,export const getDb=()=>globalThis.__archiveTestDb',shortCircuit:true};
   if(specifier==='../db/schema')return next(new URL('db/schema.ts',root).href,context);
  }
  return next(specifier,context);
 },
 load(url,context,next){
  if(url.startsWith(root.href)&&url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};
  return next(url,context);
 }
});
const {createTask,updateTask,getTask,snapshot,taskHistory,claimTask,reportTask,askQuestion,answerQuestion,recordRunEvent,setSetting,BoardError}=await import('./board-server.ts');
const {boardInput}=await import('./contracts.ts');
let sqlite, beforeUpdate;
beforeEach(()=>{
 sqlite=new DatabaseSync(':memory:');
 const migrations=new URL('drizzle/',root);
 for(const file of readdirSync(migrations).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(file,migrations),'utf8'));
 globalThis.__archiveD1={prepare(sql){let params=[];return {bind(...values){params=values;return this;},async first(){return sqlite.prepare(sql).get(...params)??null;},async run(){const result=sqlite.prepare(sql).run(...params);return {meta:{changes:Number(result.changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 globalThis.__archiveTestDb=drizzle(async(sql,params,method)=>{
  if(beforeUpdate&&sql.startsWith('update ')){const change=beforeUpdate;beforeUpdate=null;change();}
  const statement=sqlite.prepare(sql);
  if(method==='run')return statement.run(...params);
  statement.setReturnArrays(true);
  return {rows:method==='get'?statement.get(...params):statement.all(...params)};
 });
 sqlite.prepare('INSERT INTO projects (id,name,path,host) VALUES (?,?,?,?)').run('project','Project','/project','local');
 sqlite.prepare('INSERT INTO tasks (id,project_id,title,status,result,created_at,started_at,finished_at,thread_id,turn_id,run_id,screenshots,attachments) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('task','project','Completed task','done','Saved result',100,200,300,'thread','turn','run',JSON.stringify([{key:'screenshot',caption:'Result'}]),JSON.stringify([{key:'attachment',name:'input.txt',type:'text/plain',size:3}]));
});
afterEach(()=>{sqlite.close();beforeUpdate=null;delete globalThis.__archiveTestDb;delete globalThis.__archiveD1;});

test('archive and unarchive preserve all task data and persist in snapshots',async()=>{
 const original=await getTask('task');
 const archived=await updateTask('task',{action:'archive'});
 assert.deepEqual(archived,{...original,status:'archived'});
 assert.deepEqual((await snapshot()).tasks,[archived]);
 const restored=await updateTask('task',{action:'unarchive'});
 assert.deepEqual(restored,original);
 assert.deepEqual((await snapshot()).tasks,[original]);
});
test('only completed tasks can be archived',async()=>{
 for(const status of ['backlog','queued','running','archived']){
  sqlite.prepare('UPDATE tasks SET status=? WHERE id=?').run(status,'task');
  const original=await getTask('task');
  await assert.rejects(updateTask('task',{action:'archive'}),BoardError);
  assert.deepEqual(await getTask('task'),original);
 }
});
test('only archived tasks can be unarchived',async()=>{
 for(const status of ['backlog','queued','running','done']){
  sqlite.prepare('UPDATE tasks SET status=? WHERE id=?').run(status,'task');
  await assert.rejects(updateTask('task',{action:'unarchive'}),BoardError);
  assert.equal((await getTask('task')).status,status);
 }
});
test('archiving does not overwrite a concurrent status change',async()=>{
 beforeUpdate=()=>sqlite.prepare('UPDATE tasks SET status=? WHERE id=?').run('running','task');
 await assert.rejects(updateTask('task',{action:'archive'}),error=>error instanceof BoardError&&error.status===409);
 assert.equal((await getTask('task')).status,'running');
});
test('archived tasks cannot be edited or dragged into the execution queue',async()=>{
 await updateTask('task',{action:'archive'});
 await assert.rejects(updateTask('task',{action:'move',status:'queued'}),BoardError);
 await assert.rejects(updateTask('task',{title:'Changed'}),BoardError);
 assert.equal((await getTask('task')).status,'archived');
});
test('board contract accepts archive actions and rejects archived as a move target',()=>{
 for(const action of ['archive','unarchive'])assert.equal(boardInput.safeParse({id:'task',action}).success,true);
 assert.equal(boardInput.safeParse({id:'task',action:'move',status:'archived'}).success,false);
});
const workerCapabilities=['workflow-v2','task-input-v1'];
async function queued(title='New task'){const t=await createTask({projectId:'project',title,description:'Details'});return updateTask(t.id,{action:'move',status:'queued'});}
test('completion requires user acceptance and preserves the attempt input and history',async()=>{
 const task=await queued(),run=await claimTask(['project'],workerCapabilities,'runner');
 await updateTask(task.id,{title:'Edited while running',description:'New instructions'});
 await reportTask(task.id,{runId:run.runId,status:'review',result:'Tests passed'});
 let history=await taskHistory(task.id);assert.equal(history.status,'review');assert.equal(history.runs.length,1);assert.equal(JSON.parse(history.runs[0].input).title,'New task');assert.equal(history.runs[0].status,'completed');
 assert.equal((await updateTask(task.id,{action:'accept'})).status,'done');assert.ok((await taskHistory(task.id)).events.some(e=>e.text.includes('принят')));
});
test('reports are idempotent after a lost response and stale runs cannot mutate a retry',async()=>{
 const t=await queued(),r=await claimTask(['project'],workerCapabilities);
 const report={runId:r.runId,status:'error',result:'Failed'};const once=await reportTask(t.id,report);assert.deepEqual(await reportTask(t.id,report),once);assert.equal(once.status,'running');assert.equal(once.executionStatus,'error');
 await updateTask(t.id,{action:'retry'});const next=await claimTask(['project'],workerCapabilities);assert.notEqual(next.runId,r.runId);
 await assert.rejects(reportTask(t.id,{...report,threadId:'stale-thread'}),e=>e.status===409);assert.deepEqual(await getTask(t.id),next);
});
test('report write compares the run again after the initial read',async()=>{
 const t=await queued(),r=await claimTask(['project'],workerCapabilities);
 beforeUpdate=()=>sqlite.prepare('UPDATE tasks SET run_id=? WHERE id=?').run('replacement',t.id);
 await assert.rejects(reportTask(t.id,{runId:r.runId,status:'review',result:'Stale result'}),e=>e.status===409);assert.equal((await getTask(t.id)).result,'');
});
test('queue order is global, new enqueues append, same-lane moves reorder and claims serialize',async()=>{
 const older=await createTask({projectId:'project',title:'Old backlog task'}),a=await queued('A'),b=await queued('B');
 await updateTask(older.id,{action:'move',status:'queued'});assert.deepEqual((await snapshot()).tasks.filter(t=>t.status==='queued').map(t=>t.title),['A','B','Old backlog task']);
 await updateTask(b.id,{action:'move',status:'queued',beforeId:a.id});assert.equal((await snapshot()).tasks.filter(t=>t.status==='queued')[0].id,b.id);
 await updateTask(older.id,{action:'reorder',direction:'first'});
 const claims=await Promise.all([claimTask(['project'],workerCapabilities,'one'),claimTask(['project'],workerCapabilities,'two')]);assert.equal(claims.filter(Boolean).length,1);assert.equal(claims.find(Boolean).id,older.id);
});
test('pausing and old agents cannot claim work',async()=>{
 await queued();assert.equal(await claimTask(['project'],[]),null);await setSetting('paused',true);assert.equal(await claimTask(['project'],workerCapabilities),null);
 await setSetting('paused',false);assert.ok(await claimTask(['project'],workerCapabilities));
});
test('interactive request, answer and resolution are retained and guarded by run identity',async()=>{
 const task=await queued(),run=await claimTask(['project'],workerCapabilities);
 const question={id:'request-1',prompt:'Allow command?',method:'item/commandExecution/requestApproval',params:{command:'test'},live:true};
 const waiting=await askQuestion(task.id,run.runId,question);assert.equal(waiting.executionStatus,'waiting');assert.equal(waiting.status,'running');
 assert.equal(await claimTask(['project'],workerCapabilities),null);
 await answerQuestion(task.id,question.id,JSON.stringify({decision:'decline'}));await assert.rejects(answerQuestion(task.id,question.id,'again'),e=>e.status===409);
 await recordRunEvent(task.id,run.runId,'resolved','question-resolved',question.id);const current=await getTask(task.id);assert.equal(current.question,null);assert.equal(current.executionStatus,'running');
 const history=await taskHistory(task.id);assert.ok(history.events.some(e=>e.type==='question'));assert.ok(history.events.some(e=>e.type==='answer'));
 await assert.rejects(askQuestion(task.id,'stale',question),e=>e.status===409);
});
test('user stop without connectivity holds the global execution slot until acknowledged',async()=>{
 const t=await queued(),run=await claimTask(['project'],workerCapabilities,'offline');await queued('Next');
 const stopped=await updateTask(t.id,{action:'stop'});assert.equal(stopped.stopRequested,1);assert.equal(stopped.finishedAt,null);assert.equal(await claimTask(['project'],workerCapabilities),null);
 await reportTask(t.id,{runId:run.runId,status:'stopped',result:'Stopped'});assert.ok(await claimTask(['project'],workerCapabilities));
});
