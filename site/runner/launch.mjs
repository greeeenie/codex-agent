// Receives the service token through hidden stdin and hands it directly to a
// detached local process. The token is never written to disk or command args.
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.stdin.setRawMode?.(true);console.log('Ready for runner configuration (input is hidden).');
let buffer='';process.stdin.on('data',chunk=>{buffer+=chunk.toString();if(!/[\r\n]/.test(buffer))return;process.stdin.pause();process.stdin.setRawMode?.(false);
 try{const config=JSON.parse(buffer.trim());const log=openSync(path.join(root,'.sites-runtime','runner.log'),'a');const child=spawn(process.execPath,[path.join(root,'runner','start.mjs'),'--stdin'],{cwd:root,detached:true,windowsHide:true,stdio:['pipe',log,log]});child.on('error',e=>{console.error(e.message);process.exitCode=1;});child.stdin.end(JSON.stringify(config)+'\n');child.unref();closeSync(log);console.log(JSON.stringify({started:true,pid:child.pid,log:'.sites-runtime/runner.log'}));
 }catch(e){console.error(e.message);process.exitCode=1;}
});process.stdin.resume();
