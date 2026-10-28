import {readFile,unlink,open,mkdir} from 'node:fs/promises';
import {Runner} from './engine.mjs';
import {savedToken,connectSite} from './connect.mjs';
import {discoverProjects} from './projects.mjs';
import {status} from './desktop-status.mjs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=process.env.CODEX_AGENT_DATA_DIR??path.join(root,'.sites-runtime');
const lockfile=path.join(dataDir,'runner.lock');
let ownsLock=false,runner,stopping=false;
const abort=new AbortController();
async function takeLock(){
 await mkdir(dataDir,{recursive:true});
 try{const lock=await open(lockfile,'wx');await lock.writeFile(String(process.pid));await lock.close();ownsLock=true;}
 catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(await readFile(lockfile,'utf8'));let alive=false;try{process.kill(pid,0);alive=true;}catch{}if(alive)throw new Error('Another agent is already running.');await unlink(lockfile);return takeLock();}
}
async function shutdown(){if(stopping)return;stopping=true;abort.abort();await runner?.stop();if(ownsLock){await unlink(lockfile).catch(()=>{});ownsLock=false;}process.exit(0);}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,shutdown);
if(process.argv.includes('--desktop')){process.stdin.setEncoding('utf8');process.stdin.on('data',data=>{if(data.trim()==='shutdown')shutdown();});process.stdin.resume();}
async function hiddenConfig(){process.stdin.setRawMode?.(true);console.log('Ready for runner configuration (input is hidden).');return new Promise((resolve,reject)=>{let line='';const read=chunk=>{line+=chunk.toString();if(/[\r\n]/.test(line)){process.stdin.off('data',read);process.stdin.setRawMode?.(false);process.stdin.pause();try{resolve(JSON.parse(line.trim()));}catch(e){reject(e);}}};process.stdin.on('data',read);process.stdin.resume();});}
try{
 const settings=await readFile(path.join(dataDir,'runner.json'),'utf8').then(JSON.parse).catch(()=>({url:'https://agent-board-stepan.readymars.chatgpt.site'}));
 const input=process.argv.includes('--stdin')?await hiddenConfig():{};
 const config={...settings,...input,token:input.token??process.env.SITES_SERVICE_TOKEN};
 const origin=new URL(config.url);if(origin.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(origin.hostname))throw new Error('HTTPS is required.');config.url=origin.origin;
 config.discoverProjects=!config.projects?.length;if(config.discoverProjects)config.projects=await discoverProjects();
 await takeLock();status('connecting','Connecting to Codex Hub');
 if(!config.token)config.token=await savedToken(config.url);
 if(!config.token){status('pairing','Confirm this computer in your browser');config.token=await connectSite(config.url,{signal:abort.signal});}
 if(stopping)process.exit(0);
 runner=new Runner(config);await runner.start();
 console.log('Codex Agent started. Queue polling does not invoke the model.');
 while(!stopping){
  try{await runner.tick();}catch(e){status('error',e.message);console.error('Codex Agent: '+e.message);if(runner.closed)throw e;}
  await new Promise(resolve=>{const timer=setTimeout(resolve,5000);abort.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
 }
}catch(e){if(!stopping){status(e.code==='CODEX_NOT_FOUND'?'missing-codex':'error',e.message);console.error('Codex Agent: '+e.message);process.exitCode=1;}}
finally{await runner?.stop();if(ownsLock)await unlink(lockfile).catch(()=>{});process.stdin.pause();}
