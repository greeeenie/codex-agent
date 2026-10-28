import {readFile,writeFile,unlink,open,mkdir} from 'node:fs/promises';
import {Runner} from './engine.mjs';
import {savedToken,connectSite} from './connect.mjs';
import {discoverProjects} from './projects.mjs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const lockfile=path.join(root,'.sites-runtime','runner.lock');let ownsLock=false;
async function takeLock(){await mkdir(path.dirname(lockfile),{recursive:true});try{const lock=await open(lockfile,'wx');await lock.writeFile(String(process.pid));await lock.close();ownsLock=true;}catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(await readFile(lockfile,'utf8'));let alive=false;try{process.kill(pid,0);alive=true;}catch{}if(alive)throw new Error('Локальный агент уже запущен.');await unlink(lockfile);return takeLock();}}
async function hiddenConfig(){process.stdin.setRawMode?.(true);process.stdout.write('Ready for runner configuration (input is hidden).\n');return new Promise((resolve,reject)=>{let line='';const read=chunk=>{line+=chunk.toString();if(line.includes('\n')||line.includes('\r')){process.stdin.off('data',read);process.stdin.setRawMode?.(false);process.stdin.pause();try{resolve(JSON.parse(line.trim()));}catch(e){reject(e);}}};process.stdin.on('data',read);process.stdin.resume();});}
try{
 const settings=await readFile(path.join(root,'.sites-runtime','runner.json'),'utf8').then(JSON.parse).catch(()=>({url:'https://agent-board-stepan.readymars.chatgpt.site'}));
 const input=process.argv.includes('--stdin')?await hiddenConfig():{};
 const config={...settings,...input,token:input.token??process.env.SITES_SERVICE_TOKEN};
 const origin=new URL(config.url);if(origin.protocol!=='https:'&&origin.hostname!=='127.0.0.1'&&origin.hostname!=='localhost')throw new Error('Для Sites необходим HTTPS');config.url=origin.origin;
 if(!config.projects?.length)config.projects=await discoverProjects();
 if(!config.projects?.length)throw new Error('Откройте нужную папку как проект в Codex и запустите агент ещё раз.');
 await takeLock();
 config.token??=await savedToken(config.url)??await connectSite(config.url);
 const runner=new Runner(config);await runner.start();console.log('Agent Board: Codex подключён. Проверка очереди каждые 5 секунд.');
 let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{stopping=true;await runner.stop();if(ownsLock)await unlink(lockfile).catch(()=>{});process.exit(0);});
 while(!stopping){try{await runner.tick();}catch(e){console.error(`Agent Board: ${e.message}`);if(runner.closed){await runner.stop();process.exitCode=1;break;}}await new Promise(r=>setTimeout(r,5000));}
}catch(e){console.error(`Agent Board: ${e.message}`);process.exitCode=1;}
finally{if(ownsLock)await unlink(lockfile).catch(()=>{});}
