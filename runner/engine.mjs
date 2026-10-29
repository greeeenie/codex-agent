import {readFile,writeFile,rename,realpath,stat,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {CodexClient} from './codex-client.mjs';
import {openBrowser} from './connect.mjs';
import {status} from './desktop-status.mjs';
import {discoverProjects,resolveCodexProject} from './projects.mjs';
import {generateTaskTitle} from './task-title.mjs';
import {taskResultSchema,readTaskResult} from './task-result.mjs';
import {readModels} from './models.mjs';
import {prepareAttachments} from './attachments.mjs';
import {interactionMethods,interactionPrompt,interactionReply} from '../lib/interaction.mjs';

export const capabilities=['workflow-v2','task-title-v1','task-input-v1','live-requests-v1','thread-import-v1'];
export class Runner{
 constructor(config,client=new CodexClient()){
  this.config=config;this.client=client;this.runnerId=config.runnerId??createHash('sha256').update(os.hostname()+':'+(config.dataDir??import.meta.url)).digest('hex').slice(0,32);
  this.agent={account:null};this.active=null;this.reportPending=null;this.lastCommand=null;this.lastAccountRead=0;this.closed=false;
  this.titleJob=null;this.titleRetry=new Map();this.titleAbort=new AbortController();this.generateTitle=generateTaskTitle;
  this.events=[];this.eventChain=Promise.resolve();this.persistChain=Promise.resolve();this.lastThreadRead=0;
 }
 async request(body){
  const r=await fetch(`${this.config.url}/api/runner`,{method:'POST',headers:{'Content-Type':'application/json','OAI-Sites-Authorization':`Bearer ${this.config.token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!r.ok){const message=await r.json().catch(()=>({}));throw Object.assign(new Error(message.error??`Sites: HTTP ${r.status}`),{status:r.status});}return r.json();
 }
 persist(){
  if(!this.config.dataDir)return Promise.resolve();
  const value=JSON.stringify({report:this.reportPending,active:this.active?{id:this.active.id,runId:this.active.runId,threadId:this.active.threadId,turnId:this.active.turnId}:null,events:this.events});
  this.persistChain=this.persistChain.catch(()=>{}).then(async()=>{await mkdir(this.config.dataDir,{recursive:true});const file=path.join(this.config.dataDir,'execution.json');await writeFile(file+'.tmp',value);await rename(file+'.tmp',file);});return this.persistChain;
 }
 async start(){
  this.client.on('closed',e=>{this.agent.error=e.message;this.closed=true;});
  // Completion must not overtake the final message or an interactive request.
  this.client.on('notification',m=>{this.eventChain=this.eventChain.then(()=>this.notification(m)).catch(e=>console.error(e.message));});
  this.client.on('request',m=>{this.eventChain=this.eventChain.then(()=>this.serverRequest(m)).catch(e=>console.error(e.message));});
  await this.client.start();await this.refreshAccount();
  if(!this.agent.account){status('signing-in','Sign in to Codex in your browser');const login=await this.client.call('account/login/start',{type:'chatgpt'});this.agent.authUrl=login.authUrl;openBrowser(login.authUrl);}
  await this.recover();
 }
 async refreshAccount(){
  this.lastAccountRead=Date.now();try{
   const {account}=await this.client.call('account/read',{refreshToken:false});this.agent.account=account;
   if(account?.type==='chatgpt'){const limits=await this.client.call('account/rateLimits/read',{});this.agent.rateLimits=limits.rateLimits??{};}
   if(account){delete this.agent.authUrl;delete this.agent.error;try{this.agent.models=await readModels(this.client);}catch(e){this.agent.error=`Не удалось получить список моделей: ${e.message}`;}}
  }catch(e){this.agent.error=e.message;}
 }
 async recover(){
  const saved=this.config.dataDir?await readFile(path.join(this.config.dataDir,'execution.json'),'utf8').then(JSON.parse).catch(()=>null):null;
  if(saved?.report)this.reportPending=saved.report;if(saved?.events)this.events=saved.events;
  if(this.reportPending){try{await this.request(this.reportPending);this.reportPending=null;}catch(e){if(e.status===409)this.reportPending=null;else throw e;}}
  const state=await this.request({action:'state'}),ids=new Set(this.config.projects.map(p=>p.id));
  for(const t of state.tasks.filter(t=>t.status==='running'&&!t.finishedAt&&ids.has(t.projectId)&&(t.runnerId===this.runnerId||!t.runnerId))){
   const context=saved?.active?.runId===t.runId?saved.active:t;let observed=null;
   if(context.threadId)try{observed=(await this.client.call('thread/read',{threadId:context.threadId,includeTurns:true})).thread;}catch{}
   const turn=context.turnId?observed?.turns?.find(turn=>turn.id===context.turnId):null;
   // Read persisted evidence; never start a new turn merely because the process restarted.
   let result=null;if(turn?.status==='completed')try{result=readTaskResult((turn.items??[]).filter(i=>i.type==='agentMessage'&&i.phase!=='commentary').at(-1)?.text??'');}catch{}
   const message=result?.message??(t.question?'Соединение с живым запросом потеряно. Вопрос и история сохранены. Нажмите «Продолжить с контекстом».':'Предыдущий запуск прервался. Состояние чата проверено; автоматический повтор не запускался. Проверьте изменения и продолжите с контекстом.');
   await this.request({action:'report',id:t.id,runId:t.runId,...(context.threadId?{threadId:context.threadId}:{}),status:result?.state==='done'?'review':t.question||result?.state==='question'?'waiting':'stopped',result:message});
  }
  await this.persist();
 }
 async tick(){
  if(this.closed)throw new Error('Соединение с Codex прервалось. Контекст сохранён.');
  if(Date.now()-this.lastAccountRead>60000){await this.refreshAccount();if(this.config.discoverProjects)this.config.projects=await discoverProjects();}
  const {command,titleTasks,work=[]}=await this.request({action:'heartbeat',projects:this.config.projects,agent:this.agent,runnerId:this.runnerId,capabilities});
  if(this.agent.account&&!this.agent.authUrl&&!this.active)this.startTitleGeneration(titleTasks??[]);
  if(command?.type==='login'&&command.id!==this.lastCommand){this.lastCommand=command.id;const login=await this.client.call('account/login/start',{type:'chatgpt'});this.agent.authUrl=login.authUrl;return;}
  // Drain activity before final status so the server accepts events of this attempt.
  await this.flushEvents();
  if(this.reportPending){
   try{await this.request(this.reportPending);}catch(e){if(e.status!==409)throw e;}
   this.reportPending=null;this.active=null;await this.persist();
  }
  if(this.active){
   const current=this.active,task=work.find(t=>t.id===current.id)??(await this.request({action:'state'})).tasks?.find(t=>t.id===current.id);
   if(!task||task.runId!==current.runId||task.finishedAt){if(current.turnId)await this.client.call('turn/interrupt',{threadId:current.threadId,turnId:current.turnId}).catch(()=>{});if(this.active===current)this.active=null;await this.persist();return;}
   if(task.stopRequested){
    if(current.turnId&&!current.interrupting){current.interrupting=true;await this.client.call('turn/interrupt',{threadId:current.threadId,turnId:current.turnId});}
    if(!current.turnId)await this.finish('stopped','Задача остановлена пользователем. Контекст и изменения сохранены.');return;
   }
   const waiting=current.interactions?.[0];
   if(waiting){
    status('waiting-answer','Waiting for your answer on the board');await this.publishQuestion();
    if(task.question?.id===waiting.question.id&&task.question.answer!==null&&task.question.answer!==undefined&&!waiting.replied){
     const response=interactionReply(waiting.question,task.question.answer);
     waiting.replied=true;
     if(waiting.question.method!=='structured-question')this.client.reply(waiting.requestId,response);
     current.interactions.shift();this.queueEvent('question-resolved',waiting.question.id,`${current.runId}:resolved:${waiting.question.id}`);await this.flushEvents();
     if(waiting.question.method==='structured-question')await this.startTurn(`Ответ пользователя на вопрос «${waiting.question.prompt}»:\n${task.question.answer}\n\nПродолжи исходное задание с сохранённым контекстом.`);
     await this.persist();
    }
   }else status('running','Codex is working on a task');
   const delivered=new Set((task.events??[]).filter(e=>e.type==='message-delivered').map(e=>e.text));
   for(const e of (task.events??[]).filter(e=>e.type==='message'&&e.runId===current.runId&&!delivered.has(e.id)).reverse()){
    if(current.delivered.has(e.id)||!current.turnId||current.interactions.length)continue;
    await this.client.call('turn/steer',{threadId:current.threadId,expectedTurnId:current.turnId,input:[{type:'text',text:e.text}]});current.delivered.add(e.id);this.queueEvent('message-delivered',e.id,`${current.runId}:message:${e.id}`);
   }
   return;
  }
  if(!this.agent.account||this.agent.authUrl){status('signing-in','Sign in to Codex');return;}
  status(this.config.projects.length?'ready':'waiting-projects','');
  const {task}=await this.request({action:'claim',projectIds:this.config.projects.map(p=>p.id),runnerId:this.runnerId,capabilities});if(task)await this.execute(task);
  else if(Date.now()-this.lastThreadRead>120000)await this.refreshThreads();
 }
 async refreshThreads(){
  this.lastThreadRead=Date.now();for(const project of this.config.projects)try{
   const page=await this.client.call('thread/list',{cwd:project.path,limit:50,archived:false});
   const threads=(page.data??[]).filter(t=>path.resolve(t.cwd??'')===path.resolve(project.path)).map(t=>({id:t.id,title:String(t.name??t.preview??'Чат Codex').slice(0,180)}));
   await this.request({action:'threads',runnerId:this.runnerId,projectId:project.id,threads});
  }catch{this.agent.threadImportError='Codex не предоставил список чатов. Используйте связывание по ID.';}
 }
 startTitleGeneration(tasks){
  if(this.titleJob||this.titleAbort.signal.aborted)return;
  const task=tasks.find(t=>(this.titleRetry.get(t.id)??0)<=Date.now());if(!task)return;
  this.titleJob=(async()=>{
   try{const title=await this.generateTitle(task.description,{signal:this.titleAbort.signal});await this.request({action:'title',id:task.id,description:task.description,title});this.titleRetry.delete(task.id);}
   catch{await this.request({action:'title',id:task.id,description:task.description,title:'Новая задача',fallback:true}).catch(()=>{});this.titleRetry.set(task.id,Date.now()+60000);}
   finally{this.titleJob=null;}
  })();
 }
 async execute(task){
  status('running','Codex is working on a task');this.active={...task,messages:[],interactions:[],delivered:new Set()};await this.persist();
  try{
   const project=this.config.projects.find(p=>p.id===task.projectId);if(!project)throw new Error('Проект не разрешён на этом компьютере');
   const cwd=await realpath(project.path);if(!(await stat(cwd)).isDirectory())throw new Error('Папка проекта не найдена');
   const projectId=await resolveCodexProject(this.client,project,cwd);this.active.cwd=cwd;
   if(task.model){const model=this.agent.models?.find(m=>m.id===task.model);if(!model)throw new Error('Выбранная модель недоступна в установленном Codex');if(task.effort&&!model.efforts.includes(task.effort))throw new Error('Выбранная глубина рассуждения недоступна');}
   const attachments=await prepareAttachments(task,cwd,this.config);this.active.imageInputs=attachments.images;
   const threadParams={cwd,approvalPolicy:'on-request',sandbox:'workspace-write',...(task.model?{model:task.model}:{})};
   let resumeThreadId=task.threadId;
   // Replace only a recorded startup failure that never reached a turn, not a lost conversation.
   if(resumeThreadId){
    let previous;
    try{previous=(await this.client.call('thread/read',{threadId:resumeThreadId,includeTurns:false})).thread;}
    catch(e){
     if(!e.message.includes(resumeThreadId)||!/no rollout found for thread id|thread not loaded:/.test(e.message))throw e;
     const work=await this.request({action:'heartbeat',projects:this.config.projects,agent:this.agent,runnerId:this.runnerId,capabilities});
     const attempts=(work.work?.find(t=>t.id===task.id)?.runs??[]).filter(r=>r.threadId===resumeThreadId);
     if(!attempts.some(r=>r.status==='error'&&!r.turnId&&r.result?.includes('failed to read thread metadata: invalid thread-store request: no rollout found for thread id '+resumeThreadId))||attempts.some(r=>r.turnId))throw new Error('Сохранённый чат Codex недоступен. Свяжите другой чат или создайте копию задачи. История попыток сохранена.');
     resumeThreadId=null;this.queueEvent('activity','Создан новый чат: предыдущая попытка завершилась до начала работы.');
    }
    if(resumeThreadId){const oldCwd=previous?.cwd?await realpath(previous.cwd):null;const normalized=value=>process.platform==='win32'?value.toLowerCase():value;if(!oldCwd||normalized(oldCwd)!==normalized(cwd))throw new Error('Связанный чат принадлежит другой папке проекта. Исправьте связь перед продолжением.');}
   }
   const thread=resumeThreadId?await this.client.call('thread/resume',{...threadParams,threadId:resumeThreadId,excludeTurns:true}):await this.client.call('thread/start',{...threadParams,projectId});
   this.active.threadId=thread.thread.id;await this.persist();
   // New threads already receive projectId at creation; their rollout may not exist yet.
   if(resumeThreadId&&thread.thread.projectId!==projectId)await this.client.call('thread/metadata/update',{threadId:thread.thread.id,projectId});
   await this.client.call('thread/name/set',{threadId:thread.thread.id,name:task.title});
   await this.request({action:'report',id:task.id,runId:task.runId,threadId:thread.thread.id});
   const work=await this.request({action:'heartbeat',projects:this.config.projects,agent:this.agent,runnerId:this.runnerId,capabilities});
   const events=work.work?.find(t=>t.id===task.id)?.events??[];
   const context=events.filter(e=>['revision','message','answer','question'].includes(e.type)).slice(0,30).reverse().map(e=>`${e.type}: ${e.text}`).join('\n');
   const outputDir=path.join(cwd,'.agent-board','results',task.id);await mkdir(outputDir,{recursive:true});
   const site=await readFile(path.join(cwd,'.openai','hosting.json'),'utf8').then(JSON.parse).catch(()=>null);
   const publication=site?.project_id?'Это существующий Sites-проект. Заверши изменения публикацией по навыку Sites в тот же сайт с прежней аудиторией, если пользователь не запросил только локальную работу. При заблокированной публикации верни state=question с понятной причиной. Недоступность браузерной проверки не отменяет доступные проверки и публикацию; укажи предел проверки.':'Публикуй только по указанию пользователя.';
   const description=task.description?.trim()??'',text=description.startsWith(task.title)?description:[task.title,description].filter(Boolean).join('\n\n');
   const prompt=`${text}\n\n${context?`Сохранённые уточнения и ответы пользователя:\n${context}\n\n`:''}Выполни и проверь задачу. Сохраняй изменения пользователя. Не отправляй сообщения людям без явного указания. ${publication} Если нужен ответ или разрешение, используй структурированный запрос участия пользователя; не считай вопрос выполнением задачи.\nОтвет по JSON-схеме: если нужно уточнение — state=question, message=вопрос, screenshots=[]. После завершения работы — state=done, message=что сделано, проверки и что осталось. Результат будет передан пользователю на проверку.\nscreenshots: пути реальных PNG/JPEG/WebP внутри ${outputDir}; без визуального результата — []. Не заменяй скриншот сгенерированной картинкой.`;
   await this.startTurn(prompt+(attachments.paths.length?'\n\nПриложения:\n'+attachments.paths.join('\n'):''));
  }catch(e){await this.finish('error',`Не удалось выполнить задачу: ${e.message}`);}
 }
 async startTurn(prompt){
  const active=this.active;active.messages=[];active.finalText=null;active.turnId=null;const cwd=active.cwd;
  const turn=await this.client.call('turn/start',{threadId:active.threadId,input:[{type:'text',text:prompt},...(active.imageInputs??[])],cwd,approvalPolicy:'on-request',sandboxPolicy:{type:'workspaceWrite',writableRoots:[cwd],networkAccess:false},summary:'concise',outputSchema:taskResultSchema,...(active.model?{model:active.model}:{}),...(active.effort?{effort:active.effort}:{})});
  active.imageInputs=[];if(this.active!==active||this.reportPending)return;active.turnId=turn.turn.id;await this.persist();
  try{await this.request({action:'report',id:active.id,runId:active.runId,threadId:active.threadId,turnId:active.turnId});}catch(e){if(e.status===409){await this.client.call('turn/interrupt',{threadId:active.threadId,turnId:active.turnId}).catch(()=>{});throw e;}/* The local journal retains IDs until connectivity returns. */}
 }
 async publishQuestion(){
  const waiting=this.active?.interactions?.[0];if(!waiting||waiting.published)return;
  await this.request({action:'question',id:this.active.id,runId:this.active.runId,question:waiting.question});waiting.published=true;
 }
 queueEvent(type,text,eventId=randomUUID()){
  if(!this.active)return;this.events.push({action:'event',id:this.active.id,runId:this.active.runId,eventId,type,text:String(text).slice(0,4000)});
 }
 async flushEvents(){
  while(this.events.length){try{await this.request(this.events[0]);}catch(e){if(e.status!==409)throw e;}this.events.shift();}await this.persist();
 }
 async notification(m){
  const p=m.params??{};
  if(m.method==='account/updated'||m.method==='account/login/completed'){await this.refreshAccount();return;}
  if(m.method==='account/rateLimits/updated'){this.agent.rateLimits=p.rateLimits??p;return;}
  const active=this.active;if(!active||this.reportPending||p.threadId!==active.threadId)return;
  if(p.turnId&&active.turnId&&p.turnId!==active.turnId)return;
  if(m.method==='turn/started'){active.turnId=p.turn.id;await this.persist();}
  if(m.method==='serverRequest/resolved'){
   const id=String(p.requestId),index=active.interactions.findIndex(w=>w.question.id===id);
   if(index>=0){active.interactions.splice(index,1);this.queueEvent('question-resolved',id,`${active.runId}:resolved:${id}`);}return;
  }
  if(m.method==='item/started'||m.method==='item/completed'){
   const i=p.item??{};
   if(i.type==='agentMessage'&&m.method==='item/completed'&&i.phase!=='commentary'){active.messages.push(i.text??'');if(i.phase==='finalAnswer')active.finalText=i.text;}
   const label=i.type==='commandExecution'?`Команда: ${i.command??''}${m.method==='item/completed'?` · код ${i.exitCode??i.status??''}`:''}`:i.type==='fileChange'?'Изменение файлов':i.type==='mcpToolCall'?`Инструмент: ${i.server??''} ${i.tool??''}`:i.type==='agentMessage'&&i.phase==='commentary'?i.text:null;
   if(label){this.queueEvent('activity',label,`${active.runId}:${i.id??randomUUID()}:${m.method}`);await this.persist();}
  }
  if(m.method==='turn/completed'){
   if(p.turn?.id&&active.turnId&&p.turn.id!==active.turnId)return;
   const state=p.turn?.status;
   if(state!=='completed'){await this.finish(state==='interrupted'?'stopped':'error',state==='interrupted'?'Задача остановлена. Частичные изменения и контекст сохранены.':`Ошибка выполнения: ${p.turn?.error?.message??state??'неизвестная ошибка'}`);return;}
   let result;try{result=readTaskResult((active.finalText??active.messages.at(-1)??'').trim());}catch{await this.finish('error','Не удалось прочитать структурированный результат Codex. Контекст и изменения сохранены.');return;}
   if(result.state==='question'){
    active.turnId=null;active.interactions=[{question:{id:randomUUID(),prompt:result.message,method:'structured-question',live:true},published:false}];await this.persist();await this.publishQuestion();return;
   }
   await this.uploadScreenshots(result.screenshots.map(p=>`SCREENSHOT: ${p}`).join('\n'));await this.finish('review',result.message);
  }
 }
 async serverRequest(m){
  const active=this.active,p=m.params??{};
  if(!active||p.threadId!==active.threadId||(p.turnId&&active.turnId&&p.turnId!==active.turnId)||this.reportPending){this.client.send({id:m.id,error:{code:-32600,message:'Request does not belong to the active task'}});return;}
  if(!interactionMethods.has(m.method)){this.client.send({id:m.id,error:{code:-32601,message:'Unsupported interactive method'}});return;}
  if(active.interactions.some(w=>w.question.id===String(m.id)))return;
  active.interactions.push({requestId:m.id,question:{id:String(m.id),prompt:interactionPrompt(m.method,p),method:m.method,params:p,live:true},published:false});await this.persist();await this.publishQuestion();
 }
 async finish(state,result){
  if(!this.active||this.reportPending)return;
  this.reportPending={action:'report',id:this.active.id,runId:this.active.runId,...(this.active.threadId?{threadId:this.active.threadId}:{}),...(this.active.turnId?{turnId:this.active.turnId}:{}),status:state,result};await this.persist();
 }
 async uploadScreenshots(text){
  if(!text)return;const root=await realpath(path.join(this.active.cwd,'.agent-board','results',this.active.id));
  for(const match of text.matchAll(/^SCREENSHOT:\s*(.+)$/gm))try{
   const filename=await realpath(match[1].trim().replace(/^['"]|['"]$/g,'')),relative=path.relative(root,filename);
   if(relative.startsWith('..')||path.isAbsolute(relative)||!relative)continue;
   const type={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[path.extname(filename).toLowerCase()];if(!type||(await stat(filename)).size>8*1024*1024)continue;
   const form=new FormData();form.set('id',this.active.id);form.set('runId',this.active.runId);form.set('file',new Blob([await readFile(filename)],{type}),path.basename(filename));form.set('caption','Результат работы Codex');
   const response=await fetch(`${this.config.url}/api/screenshots`,{method:'POST',headers:{'OAI-Sites-Authorization':`Bearer ${this.config.token}`},body:form,signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);
  }catch(e){this.queueEvent('activity',`Скриншот не загружен: ${e.message}`);}
 }
 async stop(){
  this.titleAbort.abort();await this.titleJob;
  if(this.active?.turnId)await this.client.call('turn/interrupt',{threadId:this.active.threadId,turnId:this.active.turnId}).catch(()=>{});await this.eventChain;
  if(this.active&&!this.reportPending)await this.finish('stopped','Агент остановлен. Изменения и контекст сохранены.');
  await this.flushEvents().catch(()=>{});if(this.reportPending)try{await this.request(this.reportPending);this.reportPending=null;this.active=null;}catch{}
  await this.persist();this.client.close();
 }
}
