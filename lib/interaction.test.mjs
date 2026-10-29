import test from 'node:test';
import assert from 'node:assert/strict';
import {interactionReply,interactionPrompt} from './interaction.mjs';
test('permission grants contain exactly the requested permissions and require a decision',()=>{
 const q={method:'item/permissions/requestApproval',params:{permissions:{network:{enabled:true}}}};
 assert.throws(()=>interactionReply(q,'{}'));
 assert.deepEqual(interactionReply(q,JSON.stringify({decision:'accept',values:{extra:'ignored'}})),{permissions:q.params.permissions,scope:'turn'});
 assert.deepEqual(interactionReply(q,JSON.stringify({decision:'decline'})),{permissions:{},scope:'turn'});
});
test('MCP form replies validate required fields, enums and types',()=>{
 const q={method:'mcpServer/elicitation/request',params:{mode:'form',message:'Choose',requestedSchema:{type:'object',required:['choice'],properties:{choice:{type:'string',enum:['one','two']}}}}};
 for(const values of [{},{choice:'three'},{choice:1}])assert.throws(()=>interactionReply(q,JSON.stringify({decision:'accept',values})));
 assert.deepEqual(interactionReply(q,JSON.stringify({decision:'accept',values:{choice:'one'}})),{action:'accept',content:{choice:'one'}});
 assert.deepEqual(interactionReply(q,JSON.stringify({decision:'cancel'})),{action:'cancel',content:null});
});
test('multiple user questions preserve their IDs and option labels',()=>{
 const q={method:'item/tool/requestUserInput',params:{questions:[{id:'first',question:'First?'},{id:'second',question:'Second?'}]}};
 assert.throws(()=>interactionReply(q,JSON.stringify({decision:'accept',values:{first:['A']}})));
 assert.deepEqual(interactionReply(q,JSON.stringify({decision:'accept',values:{first:['A'],second:['B']}})),{answers:{first:{answers:['A']},second:{answers:['B']}}});
 assert.match(interactionPrompt(q.method,q.params),/First\?/);
});
