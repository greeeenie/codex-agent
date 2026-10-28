import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function openBrowser(url){if(process.platform==='win32')spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{stdio:'ignore',windowsHide:true}).unref();else spawn(process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore'}).unref();}
const secretFile=path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),'.local','share'),'CodexAgent','connection.json');
async function dpapi(value,decrypt=false){
 if(process.platform!=='win32')return null;
 const script=`Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); ${decrypt?'$b=[Convert]::FromBase64String($v);$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))':'$b=[Text.Encoding]::UTF8.GetBytes($v);$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($p))'}`;
 return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{stdio:['pipe','pipe','pipe'],windowsHide:true});let output='';child.stdout.on('data',b=>output+=b);child.stderr.resume();child.on('error',reject);child.on('exit',code=>code===0?resolve(output):reject(new Error('Не удалось открыть защищённое хранилище Windows')));child.stdin.end(value);});
}
export async function savedToken(origin){try{const saved=JSON.parse(await readFile(secretFile,'utf8'));return saved.origin===origin?await dpapi(saved.ciphertext,true):null;}catch{return null;}}
export async function saveToken(origin,token){const ciphertext=await dpapi(token);if(!ciphertext)return;await mkdir(path.dirname(secretFile),{recursive:true});await writeFile(secretFile,JSON.stringify({origin,ciphertext}),{mode:0o600});}
export async function connectSite(url){
 const origin=new URL(url).origin,state=randomBytes(32).toString('hex');
 return new Promise((resolve,reject)=>{let timeout;const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/connect'||req.headers.origin!==origin){res.writeHead(403);res.end('Forbidden');return;}
  let body='';for await(const chunk of req){body+=chunk;if(body.length>16000){res.writeHead(413);res.end();return;}}
  const data=new URLSearchParams(body);if(data.get('state')!==state||!data.get('token')){res.writeHead(403);res.end('Invalid state');return;}
  const token=data.get('token');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><title>Codex подключён</title><body style="font-family:system-ui;text-align:center;padding:80px;color:#27352a"><h1>Компьютер подключён</h1><p>Можно закрыть это окно и вернуться к доске.</p></body></html>');clearTimeout(timeout);server.close();try{await saveToken(origin,token);}catch{console.log('Подключение сохранено только на время этого запуска.');}resolve(token);
 });
 server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;console.log('Подтвердите подключение компьютера в браузере.');openBrowser(`${origin}/connect?port=${port}&state=${state}`);timeout=setTimeout(()=>{server.close();reject(new Error('Подключение не подтверждено за 5 минут. Запустите агент ещё раз.'));},300000);});
 });
}
