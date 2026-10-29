import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {discoverProjects,resolveCodexProject} from './projects.mjs';

test('discovery retains the desktop-to-app-server project mapping',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'codex-project-test-'));
 try{await mkdir(path.join(dir,'repo'));await writeFile(path.join(dir,'.codex-global-state.json'),JSON.stringify({'local-projects':{p:{id:'desktop-id',name:'Repo',rootPaths:[path.join(dir,'repo')]}},'app-server-project-id-by-legacy-project-id-by-host':{['local:'+dir]:{'desktop-id':'native-id'}}}));
  const [project]=await discoverProjects(dir);assert.equal(project.id,'desktop-id');assert.equal(project.codexProjectId,'native-id');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('native identity selects the intended project when folders are duplicated',async()=>{
 const cwd=await realpath(os.tmpdir());const calls=[];const client={call:async(method,params)=>{calls.push({method,params});return {project:{id:'native-id',roots:[{path:cwd}]}};}};
 assert.equal(await resolveCodexProject(client,{id:'desktop-id',codexProjectId:'native-id'},cwd),'native-id');assert.deepEqual(calls,[{method:'project/read',params:{projectId:'native-id'}}]);
});

test('manual configurations resolve a unique matching directory across pages',async()=>{
 const cwd=await realpath(os.tmpdir());const client={call:async(method,params)=>params.cursor?{data:[{id:'native-id',roots:[{path:cwd}]}],nextCursor:null}:{data:[],nextCursor:'next'}};
 assert.equal(await resolveCodexProject(client,{id:'desktop-id'},cwd),'native-id');
});

test('ambiguous folders and missing projects never create an unassigned chat',async()=>{
 const cwd=await realpath(os.tmpdir());let data=[{id:'a',roots:[{path:cwd}]},{id:'b',roots:[{path:cwd}]}];const client={call:async()=>({data,nextCursor:null})};
 await assert.rejects(resolveCodexProject(client,{id:'desktop-id'},cwd),/несколько проектов/);data=[];await assert.rejects(resolveCodexProject(client,{id:'desktop-id'},cwd),/не найден/);
});

test('a stale native mapping cannot assign a thread to a different directory',async()=>{
 const cwd=await realpath(os.tmpdir());const client={call:async()=>({project:{id:'native-id',roots:[]}})};
 await assert.rejects(resolveCodexProject(client,{id:'desktop-id',codexProjectId:'native-id'},cwd),/изменилась/);
});
