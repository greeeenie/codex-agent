// Owner-private Site: dispatch authenticates service requests. Keep this audience.
import {snapshot,checkOrigin,syncProjects,claimTask,reportTask,setting,setSetting,BoardError} from '../../../lib/board-server';
import {runnerInput} from '../../../lib/contracts';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{checkOrigin(request);const parsed=runnerInput.safeParse(await request.json());if(!parsed.success)throw new BoardError('Invalid runner request');const d=parsed.data;
  if(d.action==='heartbeat'){await syncProjects(d.projects);await setSetting('agent',{...d.agent,seenAt:Date.now()});return Response.json({command:await setting('command')});}
  if(d.action==='claim')return Response.json({task:await claimTask(d.projectIds)});
  if(d.action==='report')return Response.json(await reportTask(d.id,d));
  if(d.action==='state')return Response.json(await snapshot());
  throw new BoardError('Неизвестное действие');
}catch(e){return Response.json({error:e instanceof Error?e.message:'Ошибка сервера'},{status:e instanceof BoardError?e.status:500});}}
