// Owner-private Site: dispatch authenticates service requests. Keep this audience.
import {snapshot,taskHistory,recordRunEvent,checkOrigin,syncAgent,claimTask,reportTask,askQuestion,setting,setSetting,pendingTaskTitles,saveGeneratedTaskTitle,BoardError} from '../../../lib/board-server';
import {runnerInput} from '../../../lib/contracts';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{checkOrigin(request);const parsed=runnerInput.safeParse(await request.json());if(!parsed.success)throw new BoardError('Invalid runner request');const d=parsed.data;
  if(d.action==='heartbeat'){await syncAgent(d.runnerId,d.projects,d.agent,d.capabilities);const state=await snapshot();const active=state.tasks.filter(t=>t.runnerId===d.runnerId&&t.status==='running'&&!t.finishedAt);const work=await Promise.all(active.map(t=>taskHistory(t.id)));return Response.json({command:await setting('command'),work,...(d.capabilities?.includes('task-title-v1')?{titleTasks:await pendingTaskTitles(d.projects.map(p=>p.id))}:{})});}
  if(d.action==='title')return Response.json(await saveGeneratedTaskTitle(d.id,d.description,d.title,d.fallback));
  if(d.action==='claim')return Response.json({task:await claimTask(d.projectIds,d.capabilities,d.runnerId)});
  if(d.action==='report')return Response.json(await reportTask(d.id,d));
  if(d.action==='question')return Response.json(await askQuestion(d.id,d.runId,d.question));
  if(d.action==='event')return Response.json(await recordRunEvent(d.id,d.runId,d.eventId,d.type,d.text));
  if(d.action==='threads'){await setSetting(`threads:${d.projectId}`,{threads:d.threads,runnerId:d.runnerId,seenAt:Date.now()});return Response.json({ok:true});}
  if(d.action==='state')return Response.json(await snapshot());
  throw new BoardError('Неизвестное действие');
}catch(e){return Response.json({error:e instanceof Error?e.message:'Ошибка сервера'},{status:e instanceof BoardError?e.status:500});}}
