import {mkdir,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
export async function prepareAttachments(task,cwd,config,fetchFile=fetch){
 if(!task.attachments?.length)return {paths:[],images:[]};
 if(task.attachments.length>8||task.attachments.reduce((n,f)=>n+f.size,0)>20*1024*1024)throw new Error('Слишком много вложений');
 if(!/^[a-zA-Z0-9_-]{1,200}$/.test(task.id)||!/^[a-zA-Z0-9_-]{1,200}$/.test(task.runId))throw new Error('Неверный путь вложений');
 const root=await realpath(cwd);let actual=root;
 for(const part of ['.agent-board','inputs',task.id,task.runId]){const directory=path.join(actual,part);await mkdir(directory).catch(e=>{if(e.code!=='EEXIST')throw e;});const resolved=await realpath(directory),relative=path.relative(root,resolved);if(relative.startsWith('..')||path.isAbsolute(relative)||!relative)throw new Error('Папка вложений выходит за пределы проекта');actual=resolved;}
 const paths=[],images=[];
 for(const file of task.attachments){
  if(!new RegExp(`^inputs/${task.id}/[a-f0-9-]{36}$`).test(file.key)||file.size<0||file.size>10*1024*1024)throw new Error('Неверное вложение');
  const response=await fetchFile(`${config.url}/api/attachments?key=${encodeURIComponent(file.key)}`,{headers:{'OAI-Sites-Authorization':`Bearer ${config.token}`},signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!response.ok)throw new Error(`Не удалось скачать вложение: HTTP ${response.status}`);
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length!==file.size)throw new Error('Размер вложения изменился');
  const name=file.name.replace(/[\\/\x00-\x1f\x7f]/g,'_').slice(0,180)||'file',filename=path.join(actual,file.key.split('/').at(-1)+'-'+name);
  await writeFile(filename,bytes,{flag:'wx'});paths.push(filename);
  if(['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))images.push({type:'localImage',path:filename});
 }
 return {paths,images};
}
