import {mkdir,readFile,writeFile,copyFile,stat,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const root=process.cwd(),versions=JSON.parse(await readFile('windows/versions.json','utf8'));
const downloads=path.join(root,'.build','downloads'),payload=path.join(root,'.build','payload');
await mkdir(downloads,{recursive:true});await mkdir(path.join(payload,'runtime','node'),{recursive:true});
// Remove the obsolete Codex payload from earlier development builds. Codex is reused from the user's installation.
const obsolete=path.resolve(payload,'runtime','codex');if(path.relative(root,obsolete).startsWith('..'))throw new Error('Invalid build directory');await rm(obsolete,{recursive:true,force:true});
for(const name of ['CODEX-LICENSE.txt','CODEX-NOTICE.txt'])await rm(path.join(payload,'licenses',name),{force:true});
const name=`node-v${versions.node}-win-x64.zip`,zip=path.join(downloads,name),base=`https://nodejs.org/dist/v${versions.node}`;
try{await stat(zip);}catch{console.log('Downloading '+name);const r=await fetch(`${base}/${name}`);if(!r.ok)throw new Error('Node.js download failed');await writeFile(zip,new Uint8Array(await r.arrayBuffer()));}
const sums=await fetch(`${base}/SHASUMS256.txt`).then(r=>r.text()),expected=sums.split('\n').find(line=>line.endsWith('  '+name))?.split(' ')[0];
const actual=createHash('sha256').update(await readFile(zip)).digest('hex');if(!expected||actual!==expected)throw new Error('Node.js SHA-256 mismatch');
const unpack=path.join(root,'.build','unpack');await mkdir(unpack,{recursive:true});execFileSync('tar.exe',['-xf',zip,'-C',unpack],{stdio:'inherit'});
await copyFile(path.join(unpack,`node-v${versions.node}-win-x64`,'node.exe'),path.join(payload,'runtime','node','node.exe'));
await mkdir(path.join(payload,'licenses'),{recursive:true});await copyFile(path.join(unpack,`node-v${versions.node}-win-x64`,'LICENSE'),path.join(payload,'licenses','NODE-LICENSE.txt'));
await writeFile(path.join(payload,'runtime-versions.json'),JSON.stringify({node:versions.node,nodeSha256:expected},null,2));
console.log('Verified Node.js '+versions.node+'. Codex is not bundled.');
