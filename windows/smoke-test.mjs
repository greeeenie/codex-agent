import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,stat,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=process.cwd(),install=path.resolve(root,'.build','install-smoke'),report=path.resolve(root,'.build','diagnostics.json');
if(path.relative(root,install).startsWith('..'))throw new Error('Invalid test install path');
await mkdir(path.join(root,'.build'),{recursive:true});
const setup=path.join(root,'dist','Codex-Agent-Setup-x64.exe');
execFileSync(setup,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/TASKS=','/DIR='+install,'/LOG='+path.join(root,'.build','install.log')],{windowsHide:true,stdio:'pipe',timeout:60000});
assert.ok((await stat(path.join(install,'CodexAgent.exe'))).size>0);assert.ok((await stat(path.join(install,'runtime','node','node.exe'))).size>0);
try{await stat(path.join(install,'runtime','codex'));throw new Error('Codex must not be bundled');}catch(e){if(e.code!=='ENOENT')throw e;}
// Remove external Node/npm from PATH: the installed runtime must be sufficient.
const env={...process.env,PATH:path.join(process.env.WINDIR,'System32'),CODEX_AGENT_DATA_DIR:path.join(root,'.build','test-data')};delete env.CODEX_BINARY;
const result=spawnSync(path.join(install,'CodexAgent.exe'),['--self-test='+report],{env,windowsHide:true,timeout:55000});
assert.equal(result.status,0,result.error?.message??'Installed diagnostic failed');
const diagnostic=JSON.parse(await readFile(report,'utf8'));assert.equal(diagnostic.ok,true);assert.equal(diagnostic.modelInvocations,0);assert.equal(diagnostic.codexAvailable,true);assert.equal(diagnostic.nodeVersion,'v24.22.2');
console.log(JSON.stringify({installed:true,noBundledCodex:true,externalNodeRemovedFromPath:true,...diagnostic}));
if(!process.argv.includes('--keep')){execFileSync(path.join(install,'unins000.exe'),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART'],{windowsHide:true,timeout:60000});console.log('Uninstall succeeded.');}
