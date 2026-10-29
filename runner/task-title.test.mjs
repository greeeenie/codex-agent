import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {generateTaskTitle} from './task-title.mjs';
import {Runner} from './engine.mjs';

class FakeCodex extends EventEmitter{
 constructor({text='{"title":"Исправить вход через Google"}',status='completed',silent=false}={}){super();this.calls=[];this.text=text;this.status=status;this.silent=silent;}
 async start(){}
 async call(method,params){this.calls.push({method,params});if(method==='model/list')return {data:[{model:'gpt-6-luna',displayName:'Luna',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]};if(method==='thread/start')return {thread:{id:'title-thread'}};
  if(method==='turn/start'&&!this.silent){this.emit('notification',{method:'item/completed',params:{threadId:'title-thread',item:{type:'agentMessage',text:this.text}}});this.emit('notification',{method:'turn/completed',params:{threadId:'title-thread',turn:{status:this.status}}});}
  return {turn:{id:'title-turn'}};
 }
 close(){this.closed=true;}
}
test('generates a distinct title using Luna low in an isolated read-only turn',async()=>{
 const client=new FakeCodex(),description='После входа через Google вижу пустую страницу. Исправь авторизацию.';
 assert.equal(await generateTaskTitle(description,{client}),'Исправить вход через Google');
 const start=client.calls.find(c=>c.method==='thread/start').params,turn=client.calls.find(c=>c.method==='turn/start').params;
 assert.equal(start.model,'gpt-6-luna');assert.equal(start.ephemeral,true);assert.equal(start.sandbox,'read-only');
 assert.equal(turn.model,'gpt-6-luna');assert.equal(turn.effort,'low');assert.equal(turn.approvalPolicy,'never');assert.equal(turn.sandboxPolicy.type,'readOnly');
 assert.deepEqual(JSON.parse(turn.input[0].text),{description});assert.equal(client.closed,true);assert.equal(client.listenerCount('notification'),0);
});
test('rejects failed turns, malformed output, duplicate or oversized titles',async()=>{
 for(const options of [{status:'failed'},{text:'invalid JSON'},{text:'{"title":""}'},{text:'{"title":"Description"}'},{text:JSON.stringify({title:'x'.repeat(81)})},{text:JSON.stringify({title:'Two\nlines'})}]){
  const client=new FakeCodex(options);await assert.rejects(generateTaskTitle('Description',{client}));assert.equal(client.closed,true);
 }
});
test('timeouts and shutdown close the title client',async()=>{
 const client=new FakeCodex({silent:true});await assert.rejects(generateTaskTitle('Description',{client,timeoutMs:10}),/timed out/);assert.equal(client.closed,true);
 const abort=new AbortController(),second=new FakeCodex({silent:true});const pending=generateTaskTitle('Description',{client:second,signal:abort.signal});setImmediate(()=>abort.abort());await assert.rejects(pending);assert.equal(second.closed,true);
});
test('title generation waits for an active task and never claims a second task',async()=>{
 const runner=new Runner({projects:[]},new FakeCodex());runner.agent={account:{type:'chatgpt'}};runner.lastAccountRead=Date.now();runner.active={id:'active',runId:'r',threadId:'work-thread',interactions:[],delivered:new Set()};
 let resolve;runner.generateTitle=()=>new Promise(r=>{resolve=r;});const requests=[];
 runner.request=async body=>{requests.push(body);return body.action==='heartbeat'?{work:[{...runner.active,status:'running',finishedAt:null}],titleTasks:[{id:'new',description:'Details'}]}:{};};
 await runner.tick();await runner.tick();assert.equal(requests.filter(r=>r.action==='claim').length,0);assert.equal(runner.active.threadId,'work-thread');
 assert.equal(runner.titleJob,null);runner.active=null;runner.startTitleGeneration([{id:'new',description:'Details'}]);const job=runner.titleJob;resolve('Short title');await job;assert.deepEqual(requests.find(r=>r.action==='title'),{action:'title',id:'new',description:'Details',title:'Short title'});
});
test('title failures back off and do not block other titles',async()=>{
 const runner=new Runner({projects:[]},new FakeCodex()),tasks=[{id:'bad',description:'Bad'},{id:'good',description:'Good'}];let calls=0;
 runner.generateTitle=async()=>{calls++;throw new Error('offline');};runner.startTitleGeneration(tasks);await runner.titleJob;
 runner.startTitleGeneration(tasks);await runner.titleJob;assert.equal(calls,2);runner.startTitleGeneration(tasks);assert.equal(runner.titleJob,null);assert.equal(runner.active,null);assert.equal(runner.reportPending,null);
});
test('an unavailable requested title model never starts inference',async()=>{
 const client=new FakeCodex();client.call=async(method,params)=>{client.calls.push({method,params});return {data:[]};};
 await assert.rejects(generateTaskTitle('Description',{client}),/not available/);assert.equal(client.calls.some(c=>c.method==='turn/start'),false);
});
