import {env} from 'cloudflare:workers';
import {getTask,BoardError} from '../../../lib/board-server';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const key=new URL(request.url).searchParams.get('key');if(!key||!/^inputs\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(key))throw new BoardError('Файл не найден',404);
 const task=await getTask(key.split('/')[1]),file=task.attachments.find(a=>a.key===key);if(!file)throw new BoardError('Файл не найден',404);
 const object=await env.BUCKET!.get(key);if(!object)throw new BoardError('Файл не найден',404);
 return new Response(object.body,{headers:{'Content-Type':file.type,'Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Content-Length':String(file.size),'X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=3600'}});
}catch(e){return Response.json({error:'Файл не найден'},{status:e instanceof BoardError?e.status:500});}}
