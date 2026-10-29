import {snapshot,checkOrigin,createTask,updateTask,setSetting,BoardError} from '../../../lib/board-server';
import {boardInput} from '../../../lib/contracts';
export const dynamic='force-dynamic';
export async function GET(){return Response.json(await snapshot(),{headers:{'Cache-Control':'no-store'}});}
export async function POST(request:Request){try{checkOrigin(request);const parsed=boardInput.safeParse(await request.json());if(!parsed.success)throw new BoardError('Проверьте данные задачи');const d=parsed.data;
  if(d.action==='pause'){await setSetting('paused',!!d.paused);return Response.json({ok:true});}
  if(d.action==='login'){await setSetting('command',{type:'login',id:crypto.randomUUID()});return Response.json({ok:true});}
  return Response.json(d.id?await updateTask(d.id,d):await createTask(d));
}catch(e){return Response.json({error:e instanceof BoardError?e.message:'Не удалось сохранить. Попробуйте ещё раз.'},{status:e instanceof BoardError?e.status:500});}}
