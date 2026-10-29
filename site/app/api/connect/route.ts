import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {checkOrigin} from '../../../lib/board-server';
import {agentConnectResponse} from '../../../lib/agent-connect-response.mjs';
export async function POST(request:Request){
 try{checkOrigin(request);if(!await getChatGPTUser())return new Response('Sign in required',{status:401});
  const data=await request.formData(),port=Number(data.get('port')),state=String(data.get('state')??'');
  if(!Number.isInteger(port)||port<1024||port>65535||!/^[a-f0-9]{64}$/.test(state))return new Response('Invalid connection',{status:400});
  const token=env.AGENT_SITES_TOKEN;if(!token)return new Response('Подключение агента временно недоступно. Попробуйте позже.',{status:503});
  return agentConnectResponse(port,state,token);
 }catch{return new Response('Connection failed',{status:400});}
}
