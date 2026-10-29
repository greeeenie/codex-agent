import {snapshot,taskHistory,setting,checkOrigin,createTask,updateTask,importThread,sendTaskMessage,setSetting,setProjectHidden,answerQuestion,BoardError} from '../../../lib/board-server';
import {saveTaskFiles} from '../../../lib/attachments-server';
import {boardInput} from '../../../lib/contracts';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const url=new URL(request.url),id=url.searchParams.get('id'),projectId=url.searchParams.get('threads');return Response.json(id?await taskHistory(id):projectId?(await setting(`threads:${projectId}`)??{threads:[]}):await snapshot(),{headers:{'Cache-Control':'no-store'}});}catch(e){return Response.json({error:e instanceof Error?e.message:'Ошибка сервера'},{status:e instanceof BoardError?e.status:500});}}
export async function POST(request:Request){try{checkOrigin(request);const multipart=request.headers.get('content-type')?.includes('multipart/form-data'),form=multipart?await request.formData():null;const parsed=boardInput.safeParse(form?JSON.parse(String(form.get('data'))):await request.json());if(!parsed.success)throw new BoardError('Проверьте данные задачи');const d=parsed.data;
  if(d.action==='pause'){await setSetting('paused',!!d.paused);return Response.json({ok:true});}
  if(d.action==='login'){await setSetting('command',{type:'login',id:crypto.randomUUID()});return Response.json({ok:true});}
  if(d.action==='hideProject'||d.action==='restoreProject'){if(!d.id)throw new BoardError('Выберите проект');return Response.json(await setProjectHidden(d.id,d.action==='hideProject'));}
  if(d.action==='answer'){if(!d.id||!d.questionId||!d.answer)throw new BoardError('Введите ответ');return Response.json(await answerQuestion(d.id,d.questionId,d.answer));}
  if(d.action==='message'){if(!d.id)throw new BoardError('Выберите задачу');return Response.json(await sendTaskMessage(d.id,d.message??''));}
  if(d.action==='import')return Response.json(await importThread(d));
  return Response.json(!d.action?await saveTaskFiles(d,(form?.getAll('files')??[]).filter((f):f is File=>f instanceof File)):d.id?await updateTask(d.id,d):await createTask(d));
}catch(e){return Response.json({error:e instanceof BoardError?e.message:'Не удалось сохранить. Попробуйте ещё раз.'},{status:e instanceof BoardError?e.status:500});}}
