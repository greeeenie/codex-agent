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
 async call(method,params){this.calls.push({method,params});if(method==='account/read')return {account:{type:'chatgpt',planType:'plus'}};if(method==='account/rateLimits/read')return {rateLimits:{primary:{usedPercent:42}}};if(method==='thread/start')return {thread:{id:'thread-test'}};if(method==='turn/start')return {turn:{id:'turn-test'}};return {};}
 reply(id,result){this.replies.push({id,result});}send(){}close(){}
}
test('queue polling does not start an inference turn when empty or signed out',async()=>{
 const c=new FakeCodex(),r=new Runner({url:'https://example.test',token:'test',projects:[{id:'p'}]},c);let actions=[];
 r.request=async b=>{actions.push(b.action);return b.action==='state'?{tasks:[]}:b.action==='claim'?{task:null}:{};};
 await r.start();await r.tick();assert.equal(c.calls.filter(x=>x.method==='turn/start').length,0);assert.ok(actions.includes('claim'));r.agent.account=null;actions=[];await r.tick();assert.deepEqual(actions,['heartbeat']);
});
test('a task uses the selected project and reports only after completion',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'agent-board-test-'));
 try{const c=new FakeCodex(),r=new Runner({url:'https://example.test',token:'test',projects:[{id:'p',path:dir}]},c);r.request=async()=>({});
  await r.execute({id:'task-test',projectId:'p',runId:'run-test',title:'A task',description:'Details'});
  assert.equal(r.reportPending,null);assert.equal(c.calls.find(x=>x.method==='thread/start').params.cwd,await import('node:fs/promises').then(fs=>fs.realpath(dir)));
  assert.equal(c.calls.find(x=>x.method==='turn/start').params.sandboxPolicy.type,'workspaceWrite');
  await r.notification({method:'item/completed',params:{threadId:'thread-test',item:{type:'agentMessage',text:JSON.stringify({state:'done',message:'Готово. Проверены тесты.',screenshots:[]})}}});
  await r.notification({method:'turn/completed',params:{threadId:'thread-test',turn:{status:'completed'}}});
  assert.equal(r.reportPending.status,'done');assert.equal(r.reportPending.runId,'run-test');assert.equal(r.reportPending.result,'Готово. Проверены тесты.');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('a question waits without inference and an answer continues the same thread once',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'agent-question-test-'));
 try{const c=new FakeCodex(),r=new Runner({projects:[{id:'p',path:dir}]},c);r.lastAccountRead=Date.now();let question;
  r.request=async b=>{if(b.action==='question')question={...b.question,answer:null};return b.action==='state'?{tasks:[{id:'t',question}]}:{};};
  await r.execute({id:'t',projectId:'p',runId:'run',title:'Build',description:'Details'});
  await r.notification({method:'item/completed',params:{threadId:'thread-test',item:{type:'agentMessage',phase:'commentary',text:'Working on it'}}});
  await r.notification({method:'item/completed',params:{threadId:'thread-test',item:{type:'agentMessage',phase:'finalAnswer',text:JSON.stringify({state:'question',message:'Which color?',screenshots:[]})}}});
  await r.notification({method:'turn/completed',params:{threadId:'thread-test',turn:{status:'completed'}}});
  assert.equal(r.reportPending,null);assert.equal(question.prompt,'Which color?');
  for(let i=0;i<4;i++)await r.tick();assert.equal(c.calls.filter(x=>x.method==='turn/start').length,1);
  question.answer='Almost black';await r.tick();await r.tick();
  const turns=c.calls.filter(x=>x.method==='turn/start');assert.equal(turns.length,2);assert.equal(turns[1].params.threadId,turns[0].params.threadId);assert.match(turns[1].params.input[0].text,/Almost black/);
  await r.notification({method:'item/completed',params:{threadId:'thread-test',item:{type:'agentMessage',text:JSON.stringify({state:'done',message:'Done and checked.',screenshots:[]})}}});
  await r.notification({method:'turn/completed',params:{threadId:'thread-test',turn:{status:'completed'}}});assert.equal(r.reportPending.status,'done');assert.equal(r.reportPending.result,'Done and checked.');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('offline question publication is retried with the same id and no new model turn',async()=>{
 const c=new FakeCodex(),r=new Runner({projects:[]},c);r.lastAccountRead=Date.now();r.active={id:'t',runId:'r',threadId:'th',messages:[JSON.stringify({state:'question',message:'Which project?',screenshots:[]})]};let fail=true,ids=[];
 r.request=async b=>{if(b.action==='question'){ids.push(b.question.id);if(fail)throw new Error('offline');}return {tasks:[{id:'t'}]};};
 await assert.rejects(r.notification({method:'turn/completed',params:{threadId:'th',turn:{status:'completed'}}}),/offline/);fail=false;await r.tick();assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal(c.calls.length,0);assert.equal(r.reportPending,null);
});

test('stopping a waiting task starts no model turn and returns it to backlog',async()=>{
 const c=new FakeCodex(),r=new Runner({projects:[]},c);r.lastAccountRead=Date.now();r.active={id:'t',runId:'r',threadId:'th',waiting:{published:true,question:{id:'q'}}};r.request=async()=>({tasks:[{id:'t',stopRequested:1}]});
 await r.tick();assert.equal(r.reportPending.status,'backlog');assert.equal(c.calls.length,0);
});

test('a persisted question resumes after restart without starting work before an answer',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'agent-recover-test-'));
 try{const c=new FakeCodex(),r=new Runner({projects:[{id:'p',path:dir}]},c);r.lastAccountRead=Date.now();const task={id:'t',projectId:'p',runId:'r',threadId:'th',status:'running',question:{id:'q',prompt:'Color?',answer:null}};r.request=async()=>({tasks:[task]});
  await r.recover();await r.tick();assert.equal(c.calls.filter(x=>x.method==='turn/start').length,0);assert.equal(r.active.waiting.question.id,'q');
  task.question.answer='Black';await r.tick();assert.equal(c.calls.filter(x=>x.method==='thread/resume').length,1);assert.equal(c.calls.find(x=>x.method==='turn/start').params.threadId,'th');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('a malformed final reply never marks a task done',async()=>{
 const c=new FakeCodex(),r=new Runner({projects:[]},c);r.active={id:'t',threadId:'th',messages:['Need more details']};
 await r.notification({method:'turn/completed',params:{threadId:'th',turn:{status:'completed'}}});assert.equal(r.reportPending.status,'backlog');
});

test('closing the agent preserves a published question for recovery',async()=>{
 const c=new FakeCodex(),r=new Runner({projects:[]},c);r.active={id:'t',runId:'r',threadId:'th',turnId:null,waiting:{published:true,question:{id:'q'}}};const reports=[];r.request=async b=>{reports.push(b);return {};};await r.stop();assert.equal(reports.length,0);assert.equal(c.calls.length,0);
});
test('interrupted or failed turns never become done',async()=>{
 const c=new FakeCodex(),r=new Runner({projects:[]},c);r.uploadScreenshots=async()=>{};
 for(const status of ['interrupted','failed']){r.active={id:'t',runId:'r',threadId:'th',messages:[]};await r.notification({method:'turn/completed',params:{threadId:'th',turn:{status,error:{message:'Test error'}}}});assert.equal(r.reportPending.status,'backlog');assert.match(r.reportPending.result,status==='failed'?/Test error/:/остановлена/);}
});
test('extra permissions are declined and the turn is interrupted',async()=>{
 const c=new FakeCodex(),r=new Runner({projects:[]},c);r.active={id:'t',threadId:'th',turnId:'tr'};await r.serverRequest({id:9,method:'item/commandExecution/requestApproval',params:{reason:'Need access'}});
 assert.equal(c.replies[0].result.decision,'decline');assert.equal(c.calls.at(-1).method,'turn/interrupt');
});
test('an offline report is retained and retried before a new claim',async()=>{
 const c=new FakeCodex(),r=new Runner({projects:[]},c);r.agent={account:{type:'chatgpt'}};r.lastAccountRead=Date.now();r.active={id:'t'};r.reportPending={action:'report',id:'t'};
 let fail=true,actions=[];r.request=async b=>{actions.push(b.action);if(b.action==='report'&&fail)throw new Error('offline');return {task:null};};
 await assert.rejects(r.tick(),/offline/);assert.ok(r.reportPending);fail=false;actions=[];await r.tick();assert.deepEqual(actions,['heartbeat','report','claim']);assert.equal(r.reportPending,null);
});
