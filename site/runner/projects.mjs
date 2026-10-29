import {readFile,stat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
export async function discoverProjects(codexHome=process.env.CODEX_HOME??path.join(os.homedir(),'.codex')){
 // Read project metadata only. Never read auth.json or copy Codex credentials.
 const stateFile=path.join(codexHome,'.codex-global-state.json');let state;try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch{return [];}
 const projectIds=state['app-server-project-id-by-legacy-project-id-by-host']?.['local:'+codexHome]??{};
 const list=Object.values(state['local-projects']??{}).map(p=>({id:p.id,name:p.name,path:p.rootPaths?.[0],host:'local',...(projectIds[p.id]?{codexProjectId:projectIds[p.id]}:{})}));
 if(!list.length)for(const root of state['electron-saved-workspace-roots']??[])list.push({id:createHash('sha256').update(root).digest('hex').slice(0,24),name:path.basename(root),path:root,host:'local'});
 const valid=[];for(const p of list)try{if(p.path&&(await stat(p.path)).isDirectory())valid.push(p);}catch{}return valid;
}
export async function resolveCodexProject(client,project,cwd){
 const normalize=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
 async function hasRoot(candidate){for(const root of candidate?.roots??[])try{if(normalize(await realpath(root.path))===normalize(cwd))return true;}catch{}return false;}
 if(project.codexProjectId){
  const result=await client.call('project/read',{projectId:project.codexProjectId});
  if(await hasRoot(result.project))return result.project.id;
  throw new Error('Папка выбранного проекта в Codex изменилась. Выберите проект заново.');
 }
 const matches=[];let cursor;
 do{const page=await client.call('project/list',{limit:100,...(cursor?{cursor}:{})});
  for(const candidate of page.data){if(await hasRoot(candidate)){if(candidate.id===project.id)return candidate.id;matches.push(candidate.id);}}
  cursor=page.nextCursor;
 }while(cursor);
 if(matches.length===1)return matches[0];
 throw new Error(matches.length?'В Codex несколько проектов с этой папкой. Выберите проект заново.':'Выбранный проект не найден в Codex. Откройте его в приложении и повторите задачу.');
}
