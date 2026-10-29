import {snapshot,getTask,createTask,claimTask,reportTask,updateTask,checkOrigin} from '../../lib/board-server';
import {rpcInput} from '../../lib/contracts';
const schema=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false}),str={type:'string'};
const tools=[
  {name:'list_board',description:'Read projects, cards and agent connection. Does not start model work.',inputSchema:schema({}),annotations:{readOnlyHint:true}},
  {name:'get_task',description:'Read full task and screenshot keys. Images: /api/screenshots?key=KEY.',inputSchema:schema({id:str},['id']),annotations:{readOnlyHint:true}},
  {name:'create_task',description:'Create an authorized task in Backlog. It will not run until explicitly queued.',inputSchema:schema({projectId:str,title:str,description:str},['projectId','title'])},
  {name:'queue_task',description:'Move a Backlog task to the queue only when the user authorizes execution.',inputSchema:schema({id:str},['id'])},
  {name:'claim_next_task',description:'Atomically take oldest queued task. Save runId for reports. Execute only in selected project.',inputSchema:schema({projectIds:{type:'array',items:str}})},
  {name:'report_task',description:'Report actual execution. Include runId. Use done after completed work. Use backlog for interrupted, failed, or blocked work. Upload actual screenshots with POST /api/screenshots (id, runId, file).',inputSchema:schema({id:str,runId:str,status:{type:'string',enum:['backlog','done']},result:str,threadId:str,turnId:str},['id','runId'])},
  {name:'restore_task',description:'Return a non-running task to Backlog, preserving context and screenshots. It will not execute until explicitly queued.',inputSchema:schema({id:str},['id'])},
];
export async function POST(request:Request){let id:unknown=null;try{checkOrigin(request);const rpc=rpcInput.parse(await request.json());id=rpc.id;
  if(rpc.method==='server/discover')return Response.json({jsonrpc:'2.0',id,result:{serverInfo:{name:'agent-board',version:'1.0.0'},supportedVersions:['2026-07-28'],capabilities:{tools:{}}}});
  if(rpc.method==='initialize')return Response.json({jsonrpc:'2.0',id,result:{protocolVersion:'2025-03-26',serverInfo:{name:'agent-board',version:'1.0.0'},capabilities:{tools:{}}}});
  if(rpc.method==='tools/list')return Response.json({jsonrpc:'2.0',id,result:{tools}});
  if(rpc.method==='ping')return Response.json({jsonrpc:'2.0',id,result:{}});
  if(rpc.method.startsWith('notifications/'))return new Response(null,{status:202});
  if(rpc.method!=='tools/call')return Response.json({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
  const a=rpc.params?.arguments??{};let result;
  switch(rpc.params?.name){case 'list_board':result=await snapshot();break;case 'get_task':result=await getTask(String(a.id));break;case 'create_task':result=await createTask(a);break;case 'queue_task':result=await updateTask(String(a.id),{action:'move',status:'queued'});break;case 'claim_next_task':{const ids=a.projectIds;if(ids!==undefined&&(!Array.isArray(ids)||ids.some(x=>typeof x!=='string')||ids.length>100))throw new Error('Invalid projectIds');result=await claimTask(ids as string[]|undefined);break;}case 'report_task':result=await reportTask(String(a.id),a);break;case 'restore_task':result=await updateTask(String(a.id),{action:'restore'});break;default:throw new Error('Unknown tool');}
  return Response.json({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(result)}]}});
}catch(e){return Response.json({jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:e instanceof Error?e.message:'Tool failed'}]}});}}
