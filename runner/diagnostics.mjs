import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {CodexClient} from './codex-client.mjs';
import {discoverProjects} from './projects.mjs';
const output=process.argv[2];const client=new CodexClient();client.on('closed',()=>{});
try{await client.start();const result=await client.call('account/read',{refreshToken:false});const projects=await discoverProjects();const report={ok:true,nodeVersion:process.version,codexAvailable:true,accountType:result.account?.type??null,projectCount:projects.length,modelInvocations:0};await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));}catch(e){await writeFile(output,JSON.stringify({ok:false,error:e.message}));process.exitCode=1;}finally{client.close();}
