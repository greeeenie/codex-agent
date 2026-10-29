import {existsSync,readdirSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
export function findCodex({platform=process.platform,env=process.env,exists=existsSync,readdir=readdirSync,stat=statSync,where}={}){
 if(env.CODEX_BINARY){if(exists(env.CODEX_BINARY))return {command:env.CODEX_BINARY,args:[]};throw Object.assign(new Error('Configured Codex executable was not found.'),{code:'CODEX_NOT_FOUND'});}
 if(platform!=='win32')return {command:'codex',args:[]};
 // The desktop app extracts its signed engine into this per-user directory.
 const home=env.LOCALAPPDATA;
 if(home){const root=path.join(home,'OpenAI','Codex','bin');try{
  const candidates=readdir(root).map(name=>path.join(root,name,'codex.exe')).filter(exists).sort((a,b)=>stat(b).mtimeMs-stat(a).mtimeMs);
  if(candidates.length)return {command:candidates[0],args:[]};
 }catch{}}
 let found=[];try{found=where?where():execFileSync('where.exe',['codex'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/);}catch{}
 for(const executable of found){if(executable.toLowerCase().endsWith('.exe')&&exists(executable))return {command:executable,args:[]};const entry=path.join(path.dirname(executable),'node_modules','@openai','codex','bin','codex.js');if(exists(entry))return {command:process.execPath,args:[entry]};}
 throw Object.assign(new Error('Open your installed Codex app once, then retry.'),{code:'CODEX_NOT_FOUND'});
}
