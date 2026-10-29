import {snapshot,checkOrigin,createTask,updateTask,setSetting,setProjectHidden,answerQuestion,BoardError} from '../../../lib/board-server';
import {boardInput} from '../../../lib/contracts';
export const dynamic='force-dynamic';
export async function GET(){return Response.json(await snapshot(),{headers:{'Cache-Control':'no-store'}});}
export async function POST(request:Request){try{checkOrigin(request);const parsed=boardInput.safeParse(await request.json());if(!parsed.success)throw new BoardError('Проверьте данные задачи');const d=parsed.data;
  if(d.action==='pause'){await setSetting('paused',!!d.paused);return Response.json({ok:true});}
  if(d.action==='login'){await setSetting('command',{type:'login',id:crypto.randomUUID()});return Response.json({ok:true});}
  if(d.action==='hideProject'||d.action==='restoreProject'){if(!d.id)throw new BoardError('Выберите проект');return Response.json(await setProjectHidden(d.id,d.action==='hideProject'));}
  if(d.action==='answer'){if(!d.id||!d.questionId||!d.answer)throw new BoardError('Введите ответ');return Response.json(await answerQuestion(d.id,d.questionId,d.answer));}
  return Response.json(d.id?await updateTask(d.id,d):await createTask(d));
}catch(e){return Response.json({error:e instanceof BoardError?e.message:'Не удалось сохранить. Попробуйте ещё раз.'},{status:e instanceof BoardError?e.status:500});}}
