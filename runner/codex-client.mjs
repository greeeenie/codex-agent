import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';

export function codexCommand(){
 if(process.env.CODEX_BINARY)return {command:process.env.CODEX_BINARY,args:[]};
 // Windows npm shims need a shell; launch the official JS entrypoint with Node instead.
 if(process.platform==='win32'){
  let found=[];try{found=execFileSync('where.exe',['codex'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/);}catch{}
  for(const shim of found){const entry=path.join(path.dirname(shim),'node_modules','@openai','codex','bin','codex.js');if(existsSync(entry))return {command:process.execPath,args:[entry]};}
  throw new Error('Codex CLI не найден. Установите официальный @openai/codex или задайте CODEX_BINARY.');
 }return {command:'codex',args:[]};
}
export class CodexClient extends EventEmitter{
 constructor(){super();this.id=0;this.pending=new Map();}
 async start(){const command=codexCommand();this.child=spawn(command.command,[...command.args,'app-server','--listen','stdio://'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  this.child.stderr.on('data',()=>{}); // Don't write auth URLs or tool logs to the board.
  this.child.on('error',e=>this.fail(e));this.child.on('exit',()=>this.fail(new Error('Codex app-server завершился')));
  createInterface({input:this.child.stdout}).on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}
   if(m.id!==undefined&&!m.method){const pending=this.pending.get(m.id);if(!pending)return;clearTimeout(pending.timer);this.pending.delete(m.id);m.error?pending.reject(new Error(m.error.message)):pending.resolve(m.result);}
   else if(m.id!==undefined&&m.method){this.emit('request',m);}else{this.emit('notification',m);}
  });
  await this.call('initialize',{clientInfo:{name:'agent_board',title:'Agent Board',version:'1.0.0'}});this.send({method:'initialized',params:{}});
 }
 fail(e){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();this.emit('closed',e);}
 send(message){this.child.stdin.write(JSON.stringify(message)+'\n');}
 call(method,params={},timeout=30000){return new Promise((resolve,reject)=>{const id=++this.id;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method}: тайм-аут`));},timeout);this.pending.set(id,{resolve,reject,timer});this.send({id,method,params});});}
 reply(id,result){this.send({id,result});}
 close(){this.child?.stdin.end();this.child?.kill();}
}
