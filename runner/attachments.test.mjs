import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink,stat} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {prepareAttachments} from './attachments.mjs';import {readModels} from './models.mjs';
const key='inputs/task-test/11111111-1111-1111-1111-111111111111';
test('attachments are saved inside the project and images are passed as local image inputs',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'agent-files-test-'));
 try{let request;const config={url:'https://board.test',token:'test-only'},task={id:'task-test',runId:'run-test',attachments:[{key,name:'../image.png',type:'image/png',size:3}]};
  const result=await prepareAttachments(task,dir,config,async(url,options)=>{request={url,options};return new Response(new Uint8Array([1,2,3]));});
  assert.equal(result.paths.length,1);assert.ok(!path.relative(dir,result.paths[0]).startsWith('..'));assert.equal((await readFile(result.paths[0])).length,3);assert.deepEqual(result.images,[{type:'localImage',path:result.paths[0]}]);assert.equal(request.options.redirect,'error');assert.equal(request.options.headers['OAI-Sites-Authorization'],'Bearer test-only');
  await writeFile(result.paths[0],'user edit');await assert.rejects(prepareAttachments(task,dir,config,async()=>new Response(new Uint8Array([1,2,3]))),/EEXIST/);assert.equal(await readFile(result.paths[0],'utf8'),'user edit');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('foreign attachment keys and changed content sizes are rejected',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'agent-files-invalid-'));
 try{const task={id:'task-test',runId:'run-test',attachments:[{key:'inputs/another-task/11111111-1111-1111-1111-111111111111',name:'a.txt',type:'text/plain',size:1}]};
  await assert.rejects(prepareAttachments(task,dir,{},()=>assert.fail('must not fetch foreign files')),/Неверное вложение/);task.attachments[0].key=key;await assert.rejects(prepareAttachments(task,dir,{url:'https://board.test'},async()=>new Response('different size')),/Размер/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a symlink cannot redirect attachment writes outside the selected project',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'agent-files-symlink-')),project=path.join(dir,'project'),outside=path.join(dir,'outside');
 try{await mkdir(project);await mkdir(outside);await symlink(outside,path.join(project,'.agent-board'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(prepareAttachments({id:'task-test',runId:'run-test',attachments:[{key,name:'a.txt',type:'text/plain',size:1}]},project,{}),/пределы проекта/);await assert.rejects(stat(path.join(outside,'inputs')),/ENOENT/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('model discovery uses returned model ids and reasoning capabilities across pages',async()=>{
 const client={call:async(method,p)=>{assert.equal(method,'model/list');return p.cursor?{data:[{model:'hidden-model',displayName:'Hidden',hidden:true}],nextCursor:null}:{data:[{model:'actual-model-id',displayName:'A model',supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high',isDefault:true}],nextCursor:'next'};}};
 assert.deepEqual(await readModels(client),[{id:'actual-model-id',name:'A model',efforts:['high'],defaultEffort:'high',isDefault:true,inputModalities:['text','image']}]);
});
