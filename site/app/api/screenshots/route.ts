import {env} from 'cloudflare:workers';
import {getTask,checkOrigin,BoardError} from '../../../lib/board-server';
import {getDb} from '../../../db';
import {tasks} from '../../../db/schema';
import {eq,and,sql} from 'drizzle-orm';
export const dynamic='force-dynamic';
export async function GET(request:Request){const key=new URL(request.url).searchParams.get('key');
  if(!key||!/^[a-f0-9-]+\/[a-f0-9-]+\.(png|webp|jpg)$/.test(key))return new Response('Not found',{status:404});
  const o=await env.BUCKET!.get(key);if(!o)return new Response('Not found',{status:404});
  return new Response(o.body,{headers:{'Content-Type':o.httpMetadata?.contentType??'image/png','X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=3600'}});
}
export async function POST(request:Request){try{checkOrigin(request);const f=await request.formData(),id=String(f.get('id')),task=await getTask(id);
  if((f.get('runId')||task.status==='running')&&f.get('runId')!==task.runId)throw new BoardError('Неверный запуск',409);
  const file=f.get('file');if(!(file instanceof File)||file.size>8*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new BoardError('Выберите PNG, JPEG или WebP до 8 МБ');
  if(task.screenshots.length>=12)throw new BoardError('Не больше 12 скриншотов');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const valid=file.type==='image/png'?bytes[0]===137&&bytes[1]===80:file.type==='image/jpeg'?bytes[0]===255&&bytes[1]===216:String.fromCharCode(...bytes.slice(0,4))==='RIFF';if(!valid)throw new BoardError('Файл не похож на изображение');
  const ext=file.type==='image/jpeg'?'jpg':file.type==='image/webp'?'webp':'png',key=`${id}/${crypto.randomUUID()}.${ext}`;
  await env.BUCKET!.put(key,bytes,{httpMetadata:{contentType:file.type}});
  const shot={key,caption:String(f.get('caption')??'Результат работы').slice(0,180)};
  const changed=await getDb().update(tasks).set({screenshots:sql`json_insert(${tasks.screenshots}, '$[#]', json(${JSON.stringify(shot)}))`}).where(and(eq(tasks.id,id),sql`${tasks.runId} IS ${task.runId}`,eq(tasks.status,task.status),sql`json_array_length(${tasks.screenshots}) < 12`)).returning({id:tasks.id});
  if(!changed.length){await env.BUCKET!.delete(key);throw new BoardError('Состояние задачи изменилось. Повторите загрузку.',409);}return Response.json({screenshots:(await getTask(id)).screenshots});
}catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось загрузить'},{status:e instanceof BoardError?e.status:500});}}
