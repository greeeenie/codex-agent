import {CodexClient} from './codex-client.mjs';
const c=new CodexClient();c.on('closed',()=>{});
try{await c.start();const account=await c.call('account/read',{refreshToken:false});const limits=account.account?.type==='chatgpt'?await c.call('account/rateLimits/read',{}):null;console.log(JSON.stringify({account:account.account,rateLimits:limits?.rateLimits??null}));}finally{c.close();}
