import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Runner} from './engine.mjs';
class FakeCodex extends EventEmitter{
 constructor(){super();this.calls=[];this.replies=[];}
 async start(){}
 async call(method,params){this.calls.push({method,params});if(method==='account/read')return {account:{type:'chatgpt',planType:'plus'}};if(method==='account/rateLimits/read')return {rateLimits:{primary:{usedPercent:42}}};if(method==='model/list')return {data:[]};if(method==='project/list')return {data:[{id:'p',roots:[{path:this.cwd}]}]};if(method==='thread/start')return {thread:{id:'thread-test'}};if(method==='turn/start')return {turn:{id:'turn-test'}};return {};}
 reply(id,result){this.replies.push({id,result});}send(){}close(){}
}
test('queue polling does not start an inference turn when empty or signed out',async()=>{
 const c=new FakeCodex(),r=new Runner({url:'https://example.test',token:'test',projects:[{id:'p'}]},c);let actions=[];
 r.request=async b=>{actions.push(b.action);return b.action==='state'?{tasks:[]}:b.action==='claim'?{task:null}:{};};
 await r.start();await r.tick();assert.equal(c.calls.filter(x=>x.method==='turn/start').length,0);assert.ok(actions.includes('claim'));r.agent.account=null;actions=[];await r.tick();assert.deepEqual(actions,['heartbeat']);
});
test('a task uses the selected project and reports only after completion',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'agent-board-test-'));
 try{const c=new FakeCodex(),r=new Runner({url:'https://example.test',token:'test',projects:[{id:'p',path:dir}]},c);c.cwd=dir;r.request=async()=>({});
  await r.execute({id:'task-test',projectId:'p',runId:'run-test',title:'A task',description:'Details'});
  assert.equal(r.reportPending,null);assert.equal(c.calls.find(x=>x.method==='thread/start').params.cwd,await import('node:fs/promises').then(fs=>fs.realpath(dir)));
  assert.equal(c.calls.find(x=>x.method==='turn/start').params.sandboxPolicy.type,'workspaceWrite');
  await r.notification({method:'item/completed',params:{threadId:'thread-test',item:{type:'agentMessage',text:JSON.stringify({state:'done',message:'Готово. Проверены тесты.',screenshots:[]})}}});
  await r.notification({method:'turn/completed',params:{threadId:'thread-test',turn:{status:'completed'}}});
  assert.equal(r.reportPending.status,'review');assert.equal(r.reportPending.runId,'run-test');assert.equal(r.reportPending.result,'Готово. Проверены тесты.');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('interrupted or failed turns never become done',async()=>{
 const c=new FakeCodex(),r=new Runner({projects:[]},c);r.uploadScreenshots=async()=>{};
 for(const status of ['interrupted','failed']){r.reportPending=null;r.active={id:'t',runId:'r',threadId:'th',messages:[]};await r.notification({method:'turn/completed',params:{threadId:'th',turn:{status,error:{message:'Test error'}}}});assert.equal(r.reportPending.status,status==='interrupted'?'stopped':'error');assert.match(r.reportPending.result,status==='failed'?/Test error/:/остановлена/);}
});
test('permissions remain pending until an explicit user decision arrives',async()=>{
 const c=new FakeCodex(),r=new Runner({projects:[]},c);r.agent.account={type:'chatgpt'};r.lastAccountRead=Date.now();r.active={id:'t',runId:'r',threadId:'th',turnId:'tr',executionStatus:'running',interactions:[],delivered:new Set()};
 const task={...r.active,status:'running',finishedAt:null},requests=[];
 r.request=async body=>{requests.push(body);if(body.action==='question'){task.question={...body.question,answer:null};return task;}if(body.action==='heartbeat')return {work:[task]};return {};};
 await r.serverRequest({id:9,method:'item/commandExecution/requestApproval',params:{threadId:'th',turnId:'tr',reason:'Need access',command:'test'}});
 assert.equal(c.replies.length,0);assert.equal(c.calls.length,0);assert.equal(task.question.method,'item/commandExecution/requestApproval');
 task.question.answer=JSON.stringify({decision:'accept'});await r.tick();assert.deepEqual(c.replies,[{id:9,result:{decision:'accept'}}]);await r.tick();assert.equal(c.replies.length,1);
});
test('an offline report is retained and retried before a new claim',async()=>{
 const c=new FakeCodex(),r=new Runner({projects:[]},c);r.agent={account:{type:'chatgpt'}};r.lastAccountRead=Date.now();r.active={id:'t'};r.reportPending={action:'report',id:'t'};
 let fail=true,actions=[];r.request=async b=>{actions.push(b.action);if(b.action==='report'&&fail)throw new Error('offline');return {task:null};};
 await assert.rejects(r.tick(),/offline/);assert.ok(r.reportPending);fail=false;actions=[];await r.tick();assert.deepEqual(actions,['heartbeat','report','claim']);assert.equal(r.reportPending,null);
});
test('a structured question waits without completing or starting another task',async()=>{
 const c=new FakeCodex(),r=new Runner({projects:[]},c),requests=[];r.request=async body=>{requests.push(body);return {};};
 r.active={id:'t',runId:'r',threadId:'th',turnId:'tr',messages:[JSON.stringify({state:'question',message:'Which project should I use?',screenshots:[]})],interactions:[],delivered:new Set()};
 await r.notification({method:'turn/completed',params:{threadId:'th',turn:{id:'tr',status:'completed'}}});
 assert.equal(r.reportPending,null);assert.equal(r.active.turnId,null);assert.equal(r.active.interactions[0].question.method,'structured-question');assert.equal(requests[0].action,'question');assert.equal(c.calls.length,0);
});
test('recovery reads the exact previous turn and never restarts it blindly',async()=>{
 const c=new FakeCodex(),r=new Runner({runnerId:'mine',projects:[{id:'p'}]},c),requests=[];
 c.call=async(method,params)=>{c.calls.push({method,params});return {thread:{turns:[{id:'old-unrelated',status:'completed',items:[{type:'agentMessage',text:JSON.stringify({state:'done',message:'Old result',screenshots:[]})}]}]}};};
 r.request=async body=>{requests.push(body);return body.action==='state'?{tasks:[{id:'t',projectId:'p',runnerId:'mine',status:'running',runId:'r',threadId:'th',turnId:'lost-turn'}]}:{};};
 await r.recover();assert.equal(c.calls[0].method,'thread/read');assert.equal(c.calls.some(c=>c.method==='turn/start'),false);assert.equal(requests.find(r=>r.action==='report').status,'stopped');
});
test('late turn notifications and requests cannot change the active attempt',async()=>{
 const c=new FakeCodex(),r=new Runner({projects:[]},c);r.active={id:'t',runId:'new',threadId:'th',turnId:'new-turn',messages:[],interactions:[]};
 await r.notification({method:'turn/completed',params:{threadId:'th',turn:{id:'old-turn',status:'completed'}}});
 await r.serverRequest({id:3,method:'item/commandExecution/requestApproval',params:{threadId:'th',turnId:'old-turn'}});
 assert.equal(r.reportPending,null);assert.equal(r.active.interactions.length,0);assert.equal(c.replies.length,0);
});
