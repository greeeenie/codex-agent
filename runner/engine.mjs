import {readFile,realpath,stat,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {CodexClient} from './codex-client.mjs';
import {openBrowser} from './connect.mjs';
import {status} from './desktop-status.mjs';
import {discoverProjects} from './projects.mjs';

export class Runner{
 constructor(config,client=new CodexClient()){this.config=config;this.client=client;this.agent={account:null};this.active=null;this.reportPending=null;this.lastCommand=null;this.lastAccountRead=0;this.closed=false;}
 async request(body){const r=await fetch(`${this.config.url}/api/runner`,{method:'POST',headers:{'Content-Type':'application/json','OAI-Sites-Authorization':`Bearer ${this.config.token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`Sites: HTTP ${r.status}`);return r.json();}
 async start(){
  this.client.on('closed',e=>{this.agent.error=e.message;this.closed=true;});
  this.client.on('notification',m=>this.notification(m).catch(e=>console.error(e.message)));
  this.client.on('request',m=>this.serverRequest(m).catch(e=>console.error(e.message)));
  await this.client.start();await this.refreshAccount();
  if(!this.agent.account){status('signing-in','Sign in to Codex in your browser');const login=await this.client.call('account/login/start',{type:'chatgpt'});this.agent.authUrl=login.authUrl;openBrowser(login.authUrl);}
  await this.recover();
 }
 async refreshAccount(){this.lastAccountRead=Date.now();try{const {account}=await this.client.call('account/read',{refreshToken:false});this.agent.account=account;
  if(account?.type==='chatgpt'){const limits=await this.client.call('account/rateLimits/read',{});this.agent.rateLimits=limits.rateLimits??{};}
  if(account){delete this.agent.authUrl;delete this.agent.error;}
 }catch(e){this.agent.error=e.message;}}
 async recover(){const state=await this.request({action:'state'});const ids=new Set(this.config.projects.map(p=>p.id));
  // A lost process is never called successful; preserve context and ask for review.
  for(const t of state.tasks.filter(t=>t.status==='running'&&ids.has(t.projectId)))await this.request({action:'report',id:t.id,runId:t.runId,status:'backlog',result:'Связь с предыдущим запуском прервалась. Проверьте изменения в проекте и нажмите «Восстановить», чтобы продолжить с сохранённым контекстом.'});
 }
 async tick(){
  if(this.closed)throw new Error('Codex отключился. Перезапустите локальный агент.');
  if(Date.now()-this.lastAccountRead>60000){await this.refreshAccount();if(this.config.discoverProjects)this.config.projects=await discoverProjects();}
  const {command}=await this.request({action:'heartbeat',projects:this.config.projects,agent:this.agent});
  if(command?.type==='login'&&command.id!==this.lastCommand){this.lastCommand=command.id;const login=await this.client.call('account/login/start',{type:'chatgpt'});this.agent.authUrl=login.authUrl;await this.request({action:'heartbeat',projects:this.config.projects,agent:this.agent});}
  if(this.reportPending){await this.request(this.reportPending);this.reportPending=null;this.active=null;}
  if(this.active){status('running','Codex is working on a task');const s=await this.request({action:'state'}),task=s.tasks.find(t=>t.id===this.active.id);if(task?.stopRequested&&this.active.turnId&&!this.active.interrupting){this.active.interrupting=true;await this.client.call('turn/interrupt',{threadId:this.active.threadId,turnId:this.active.turnId});}return;}
  if(!this.agent.account||this.agent.authUrl){status('signing-in','Sign in to Codex');return;}
  status(this.active?'running':this.config.projects.length?'ready':'waiting-projects','');
  const {task}=await this.request({action:'claim',projectIds:this.config.projects.map(p=>p.id)});if(task)await this.execute(task);
 }
 async execute(task){status('running','Codex is working on a task');this.active={...task,messages:[],shots:[]};
  try{
   const project=this.config.projects.find(p=>p.id===task.projectId);if(!project)throw new Error('Проект не разрешён на этом компьютере');
   const cwd=await realpath(project.path);if(!(await stat(cwd)).isDirectory())throw new Error('Папка проекта не найдена');
   let thread;
   const threadParams={cwd,approvalPolicy:'on-request',sandbox:'workspace-write'};
   if(task.threadId){try{thread=await this.client.call('thread/resume',{...threadParams,threadId:task.threadId});}catch{thread=await this.client.call('thread/start',threadParams);}}
   else thread=await this.client.call('thread/start',threadParams);
   this.active.threadId=thread.thread.id;
   // Only this task's final report and actual image paths are retained; no activity feed.
   const outputDir=path.join(cwd,'.agent-board','results',task.id);await mkdir(outputDir,{recursive:true});
   const prompt=`Выполни задачу в выбранном проекте.\n\n${task.title}\n\n${task.description}\n\nПроверь результат. Не отправляй сообщения другим людям и не публикуй изменения без явного указания в задаче. Сохраняй существующие изменения пользователя. Если задача требует уточнения или дополнительного разрешения, явно сообщи об этом и остановись. В итоговом ответе дай не больше трёх коротких предложений: что сделано, как проверено, что осталось. Если есть доступный способ снять реальный скриншот результата, сохрани PNG/JPEG/WebP внутри ${outputDir} и укажи абсолютный путь в отдельной строке SCREENSHOT: <путь>. Не создавай картинку вместо реального скриншота. Если визуального результата нет, скриншот не нужен.`;
   const turn=await this.client.call('turn/start',{threadId:this.active.threadId,input:[{type:'text',text:prompt}],cwd,approvalPolicy:'on-request',sandboxPolicy:{type:'workspaceWrite',writableRoots:[cwd],networkAccess:false},summary:'concise'});
   if(!this.active)return;this.active.turnId=turn.turn.id;
   await this.request({action:'report',id:task.id,runId:task.runId,threadId:this.active.threadId,turnId:this.active.turnId});
  }catch(e){this.finish('backlog',`Не удалось выполнить задачу: ${e.message}`);}
 }
 async notification(m){const p=m.params??{};
  if(m.method==='account/updated'||m.method==='account/login/completed'){await this.refreshAccount();return;}
  if(m.method==='account/rateLimits/updated'){this.agent.rateLimits=p.rateLimits??p;return;}
  if(!this.active||p.threadId!==this.active.threadId)return;
  if(m.method==='item/completed'&&p.item?.type==='agentMessage')this.active.messages.push(p.item.text??'');
  if(m.method==='turn/started')this.active.turnId=p.turn.id;
  if(m.method==='turn/completed'){
   const text=this.active.messages.join('\n').trim();
   await this.uploadScreenshots(text);
   const summary=text.replace(/^SCREENSHOT:.*$/gm,'').trim().slice(0,11500);
   const status=p.turn?.status;
   this.finish(status==='completed'?'done':'backlog',status==='completed'?(summary||'Codex завершил работу. Проверьте изменения в проекте.'):status==='interrupted'?`Задача остановлена. ${this.active.blockReason??'Частичные изменения сохранены в проекте.'}`:`Ошибка выполнения: ${p.turn?.error?.message??status??'неизвестная ошибка'}`);
  }
 }
 async serverRequest(m){
  // Additional permissions are never silently granted. Surface a short review result.
  if(this.active)this.active.blockReason=`Требуется участие пользователя: ${m.params?.reason??m.params?.question??m.method}`;
  if(m.method==='item/commandExecution/requestApproval'||m.method==='item/fileChange/requestApproval')this.client.reply(m.id,{decision:'decline'});
  else if(m.method==='item/permissions/requestApproval')this.client.reply(m.id,{permissions:{},scope:'turn'});
  else if(m.method==='item/tool/requestUserInput'||m.method==='tool/requestUserInput')this.client.reply(m.id,{answers:{}});
  else if(m.method==='mcpServer/elicitation/request')this.client.reply(m.id,{action:'decline',content:null});
  else this.client.send({id:m.id,error:{code:-32601,message:'Interaction requires human review in Codex'}});
  if(this.active?.turnId)await this.client.call('turn/interrupt',{threadId:this.active.threadId,turnId:this.active.turnId}).catch(()=>{});
 }
 finish(status,result){if(!this.active)return;this.reportPending={action:'report',id:this.active.id,runId:this.active.runId,threadId:this.active.threadId,turnId:this.active.turnId,status,result};}
 async uploadScreenshots(text){const project=this.config.projects.find(p=>p.id===this.active.projectId);const root=await realpath(path.join(project.path,'.agent-board','results',this.active.id));
  for(const match of text.matchAll(/^SCREENSHOT:\s*(.+)$/gm)){
   try{const filename=await realpath(match[1].trim().replace(/^['"]|['"]$/g,'')),relative=path.relative(root,filename);
    if(relative.startsWith('..')||path.isAbsolute(relative)||!relative)continue;
    const ext=path.extname(filename).toLowerCase(),type={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[ext];if(!type)continue;
    if((await stat(filename)).size>8*1024*1024)continue;
    const f=new FormData();f.set('id',this.active.id);f.set('runId',this.active.runId);f.set('file',new Blob([await readFile(filename)],{type}),path.basename(filename));f.set('caption','Результат работы Codex');
    const r=await fetch(`${this.config.url}/api/screenshots`,{method:'POST',headers:{'OAI-Sites-Authorization':`Bearer ${this.config.token}`},body:f,signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`Скриншот: HTTP ${r.status}`);
   }catch(e){console.error(`Скриншот не загружен: ${e.message}`);}
  }
 }
 async stop(){
  if(this.active?.turnId)await this.client.call('turn/interrupt',{threadId:this.active.threadId,turnId:this.active.turnId}).catch(()=>{});
  if(this.active)await this.request(this.reportPending??{action:'report',id:this.active.id,runId:this.active.runId,threadId:this.active.threadId,status:'backlog',result:'Задача остановлена. Изменения сохранены в проекте.'}).catch(()=>{});
  this.client.close();
 }
}
