import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {drizzle} from 'drizzle-orm/sqlite-proxy';
import ts from 'typescript';
import {PENDING_TASK_TITLE} from './task-title.mjs';

const root=new URL('../',import.meta.url);
registerHooks({
 resolve(specifier,context,next){
  if(context.parentURL===new URL('lib/board-server.ts',root).href){
   if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env={}',shortCircuit:true};
   if(specifier==='../db')return {url:'data:text/javascript,export const getDb=()=>globalThis.__titleTestDb',shortCircuit:true};
   if(specifier==='../db/schema')return next(new URL('db/schema.ts',root).href,context);
  }return next(specifier,context);
 },
 load(url,context,next){if(url.startsWith(root.href)&&url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return next(url,context);}
});
const {createTask,updateTask,getTask,pendingTaskTitles,saveGeneratedTaskTitle,BoardError}=await import('./board-server.ts');
const {runnerInput}=await import('./contracts.ts');
let sqlite,beforeUpdate;
beforeEach(()=>{
 sqlite=new DatabaseSync(':memory:');const migrations=new URL('drizzle/',root);
 for(const file of readdirSync(migrations).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(file,migrations),'utf8'));
 globalThis.__titleTestDb=drizzle(async(sql,params,method)=>{
  if(beforeUpdate&&sql.startsWith('update ')){const change=beforeUpdate;beforeUpdate=null;change();}
  const statement=sqlite.prepare(sql);if(method==='run')return statement.run(...params);statement.setReturnArrays(true);return {rows:method==='get'?statement.get(...params):statement.all(...params)};
 });
 sqlite.prepare('INSERT INTO projects (id,name,path,host) VALUES (?,?,?,?)').run('project','Project','/project','local');
});
afterEach(()=>{sqlite.close();beforeUpdate=null;delete globalThis.__titleTestDb;});
const description='После входа через Google вижу пустую страницу. Исправь авторизацию.';
const create=()=>createTask({projectId:'project',description,model:null,effort:null});
test('description-only creation persists a title request and leaves task in backlog',async()=>{
 const task=await create();assert.equal(task.title,PENDING_TASK_TITLE);assert.equal(task.description,description);assert.equal(task.status,'backlog');
 assert.deepEqual(await pendingTaskTitles(['project']),[{id:task.id,description}]);
 assert.deepEqual(await saveGeneratedTaskTitle(task.id,description,'Исправить вход через Google'),{updated:true});
 const saved=await getTask(task.id);assert.deepEqual(saved,{...task,title:'Исправить вход через Google'});assert.deepEqual(await pendingTaskTitles(['project']),[]);
});
test('description edits preserve the independently editable title',async()=>{
 const task=await create();await saveGeneratedTaskTitle(task.id,description,'Исправить вход через Google');
 const unchanged=await updateTask(task.id,{description,model:null,effort:null});assert.equal(unchanged.title,'Исправить вход через Google');
 const changed=await updateTask(task.id,{description:'Добавь тёмную тему'});assert.equal(changed.title,'Исправить вход через Google');
 assert.deepEqual(await saveGeneratedTaskTitle(task.id,description,'Устаревшее название'),{updated:false});assert.equal((await getTask(task.id)).description,'Добавь тёмную тему');
});
test('a generated title never overwrites a concurrent edit or explicit title',async()=>{
 const task=await create();beforeUpdate=()=>sqlite.prepare('UPDATE tasks SET description=? WHERE id=?').run('Newer description',task.id);
 assert.deepEqual(await saveGeneratedTaskTitle(task.id,description,'Исправить вход через Google'),{updated:false});
 await updateTask(task.id,{description,title:'Название пользователя'});
 assert.deepEqual(await saveGeneratedTaskTitle(task.id,description,'Исправить вход через Google'),{updated:false});assert.equal((await getTask(task.id)).title,'Название пользователя');
});
test('title requests stay scoped to available projects and exclude archived tasks',async()=>{
 const task=await create();assert.deepEqual(await pendingTaskTitles([]),[]);assert.deepEqual(await pendingTaskTitles(['other']),[]);
 for(const column of ['is_available','is_hidden']){
  sqlite.prepare(`UPDATE projects SET ${column}=?`).run(column==='is_available'?0:1);assert.deepEqual(await pendingTaskTitles(['project']),[]);sqlite.prepare(`UPDATE projects SET ${column}=?`).run(column==='is_available'?1:0);
 }
 sqlite.prepare('UPDATE tasks SET status=? WHERE id=?').run('archived',task.id);assert.deepEqual(await pendingTaskTitles(['project']),[]);
});
test('invalid model results are rejected without changing the task',async()=>{
 const task=await create();for(const title of ['',description,'x'.repeat(81),'Two\nlines'])await assert.rejects(saveGeneratedTaskTitle(task.id,description,title),BoardError);
 assert.deepEqual(await getTask(task.id),task);await assert.rejects(createTask({projectId:'project',description:''}),BoardError);
});
test('runner contract accepts title reports and rejects invalid lengths',()=>{
 assert.equal(runnerInput.safeParse({action:'title',id:'task',description,title:'Исправить вход'}).success,true);
 assert.equal(runnerInput.safeParse({action:'title',id:'task',description,title:'x'.repeat(81)}).success,false);
});
