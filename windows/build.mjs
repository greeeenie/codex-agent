import {mkdir,readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=process.cwd(),payload=path.join(root,'.build','payload');
execFileSync(process.execPath,['windows/prepare-runtime.mjs'],{stdio:'inherit'});
await mkdir(path.join(payload,'runner'),{recursive:true});
for(const name of await readdir('runner'))if(name.endsWith('.mjs')&&!name.endsWith('.test.mjs'))await copyFile(path.join('runner',name),path.join(payload,'runner',name));
await mkdir(path.join(payload,'lib'),{recursive:true});
for(const name of ['task-title.mjs','interaction.mjs'])await copyFile(path.join('lib',name),path.join(payload,'lib',name));
await copyFile('package.json',path.join(payload,'package.json'));await copyFile('README.md',path.join(payload,'README.md'));
// A code-native icon: the same dark circle used by Codex Hub.
const csc=path.join(process.env.WINDIR??'C:/Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
execFileSync(csc,['/nologo','/r:System.Drawing.dll','/out:'+path.join(root,'.build','MakeIcon.exe'),path.join(root,'windows','MakeIcon.cs')],{stdio:'inherit'});
execFileSync(path.join(root,'.build','MakeIcon.exe'),[path.join(root,'.build','agent.ico')],{stdio:'inherit',windowsHide:true});
execFileSync(csc,['/nologo','/target:winexe','/platform:x64','/optimize+','/codepage:65001','/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll','/win32manifest:'+path.join(root,'windows','CodexAgent.exe.manifest'),'/win32icon:'+path.join(root,'.build','agent.ico'),'/out:'+path.join(payload,'CodexAgent.exe'),path.join(root,'windows','TrayApp.cs')],{stdio:'inherit'});
execFileSync(process.env.ISCC_PATH??path.join(root,'.build','tools','inno','ISCC.exe'),[path.join(root,'windows','installer.iss')],{stdio:'inherit'});
const file=path.join(root,'dist','Codex-Agent-Setup-x64.exe'),hash=createHash('sha256').update(await readFile(file)).digest('hex');
await writeFile(path.join(root,'dist','SHA256SUMS.txt'),`${hash}  Codex-Agent-Setup-x64.exe\n`);console.log('Installer built: '+file);
