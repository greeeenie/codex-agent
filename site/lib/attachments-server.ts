import {env} from 'cloudflare:workers';
import {BoardError,createTask,getTask,updateTask} from './board-server';
import type {Attachment} from './board-types';
export const MAX_FILES=8,MAX_FILE_SIZE=10*1024*1024,MAX_TOTAL_SIZE=20*1024*1024;
export async function saveTaskFiles(input:Record<string,unknown>,files:File[]){
 const existing=input.id?await getTask(String(input.id)):null;
 if(existing&&!['backlog','queued'].includes(existing.status))throw new BoardError('Сначала верните задачу в Backlog');
 const keys=input.attachmentKeys as string[]|undefined;
 if(keys?.some(key=>!existing?.attachments.some(a=>a.key===key)))throw new BoardError('Файл не принадлежит этой задаче');
 const retained=existing?.attachments.filter(a=>!keys||keys.includes(a.key))??[];
 if(files.length+retained.length>MAX_FILES)throw new BoardError('Не больше 8 файлов');
 if(files.some(f=>f.size>MAX_FILE_SIZE)||retained.reduce((n,f)=>n+f.size,0)+files.reduce((n,f)=>n+f.size,0)>MAX_TOTAL_SIZE)throw new BoardError('До 10 МБ на файл и 20 МБ на задачу');
 const id=existing?.id??crypto.randomUUID(),uploaded:Attachment[]=[];
 try{
  for(const file of files){
   const bytes=new Uint8Array(await file.arrayBuffer());let type=file.type||'application/octet-stream';
   if(['image/png','image/jpeg','image/webp','image/gif'].includes(type)){
    const valid=type==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:type==='image/jpeg'?bytes[0]===255&&bytes[1]===216:type==='image/gif'?String.fromCharCode(...bytes.slice(0,3))==='GIF':String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
    if(!valid)throw new BoardError('Не удалось прочитать изображение');
   }else if(type.startsWith('image/'))type='application/octet-stream';
   const key=`inputs/${id}/${crypto.randomUUID()}`,name=file.name.replace(/[\\/\x00-\x1f\x7f]/g,'_').slice(0,180)||'file';
   await env.BUCKET!.put(key,bytes,{httpMetadata:{contentType:type}});uploaded.push({key,name,type,size:bytes.length});
  }
  const attachments=[...retained,...uploaded];
  return existing?await updateTask(id,input,attachments):await createTask(input,attachments,id);
 }catch(e){await Promise.allSettled(uploaded.map(a=>env.BUCKET!.delete(a.key)));throw e;}
}
