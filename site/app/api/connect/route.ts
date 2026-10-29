import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {checkOrigin} from '../../../lib/board-server';
export async function POST(request:Request){
 try{checkOrigin(request);if(!await getChatGPTUser())return new Response('Sign in required',{status:401});
  const data=await request.formData(),port=Number(data.get('port')),state=String(data.get('state')??'');
  if(!Number.isInteger(port)||port<1024||port>65535||!/^[a-f0-9]{64}$/.test(state))return new Response('Invalid connection',{status:400});
  const token=env.AGENT_SITES_TOKEN;if(!token)return new Response('Подключение агента временно недоступно. Попробуйте позже.',{status:503});
  const safe=token.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');const nonce=crypto.randomUUID().replaceAll('-','');
  return new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Подключение Codex</title><body><p>Подключаем локальный агент…</p><form method="POST" action="http://127.0.0.1:${port}/connect"><input type="hidden" name="state" value="${state}"><input type="hidden" name="token" value="${safe}"><button>Продолжить</button></form><script nonce="${nonce}">document.forms[0].submit();</script></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; form-action http://127.0.0.1:${port}; frame-ancestors 'none'`}});
 }catch{return new Response('Connection failed',{status:400});}
}
