import {createServer} from 'node:http';import {spawn,spawnSync} from 'node:child_process';import {mkdir,writeFile,readFile} from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
const root=process.cwd(),install=path.join(root,'.build','install-smoke'),data=path.join(root,'.build','tray-test-data');await mkdir(data,{recursive:true});
let heartbeats=0,claims=0,resolveReady;const ready=new Promise(r=>resolveReady=r);
const server=createServer(async(req,res)=>{let text='';for await(const b of req)text+=b;const body=JSON.parse(text);res.setHeader('Content-Type','application/json');if(body.action==='state')res.end(JSON.stringify({tasks:[],projects:[],agent:null,paused:false}));else if(body.action==='heartbeat'){heartbeats++;res.end(JSON.stringify({command:null}));}else if(body.action==='claim'){claims++;res.end(JSON.stringify({task:null}));resolveReady();}else{res.statusCode=400;res.end('{}');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
await writeFile(path.join(data,'runner.json'),JSON.stringify({url,projects:[{id:'fixture-project',name:'Fixture',path:root,host:'local'}]}));
const executable=path.join(install,'CodexAgent.exe'),env={...process.env,CODEX_AGENT_DATA_DIR:data,SITES_SERVICE_TOKEN:'test-fixture-not-a-real-secret',PATH:path.join(process.env.WINDIR,'System32')};delete env.CODEX_BINARY;
const child=spawn(executable,['--autostart'],{env,windowsHide:true,stdio:'ignore'});let workerPid;
try{await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Native tray agent did not poll the fixture server')),20000))]);workerPid=Number(await readFile(path.join(data,'runner.lock'),'utf8'));assert.ok(workerPid>0);assert.ok(heartbeats>0);assert.ok(claims>0);
 const stopped=spawnSync(executable,['--shutdown'],{env,windowsHide:true,timeout:20000});assert.equal(stopped.status,0);
 await new Promise(r=>setTimeout(r,500));let alive=true;try{process.kill(workerPid,0);}catch{alive=false;}assert.equal(alive,false,'The owned Node worker must stop on tray exit');console.log(JSON.stringify({trayStartup:true,backgroundQueuePolling:true,gracefulQuit:true,ownedWorkerStopped:true,modelInvocations:0}));
}finally{if(child.exitCode===null){spawnSync(executable,['--shutdown'],{env,windowsHide:true,timeout:20000});}server.close();}
