import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
export async function discoverProjects(){
 // Read project metadata only. Never read auth.json or copy Codex credentials.
 const stateFile=path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'.codex-global-state.json');let state;try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch{return [];}
 const list=Object.values(state['local-projects']??{}).map(p=>({id:p.id,name:p.name,path:p.rootPaths?.[0],host:'local'}));
 if(!list.length)for(const root of state['electron-saved-workspace-roots']??[])list.push({id:createHash('sha256').update(root).digest('hex').slice(0,24),name:path.basename(root),path:root,host:'local'});
 const valid=[];for(const p of list)try{if(p.path&&(await stat(p.path)).isDirectory())valid.push(p);}catch{}return valid;
}
