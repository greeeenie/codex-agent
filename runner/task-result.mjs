// Constrain the final reply so a question can never be mistaken for completion.
export const taskResultSchema={type:'object',properties:{state:{type:'string',enum:['done','question']},message:{type:'string'},screenshots:{type:'array',items:{type:'string'}}},required:['state','message','screenshots'],additionalProperties:false};
export function readTaskResult(text){
 const result=JSON.parse(text);
 if(!['done','question'].includes(result.state)||typeof result.message!=='string'||!result.message.trim()||!Array.isArray(result.screenshots)||result.screenshots.some(p=>typeof p!=='string'))throw new Error('Codex returned an invalid task result');
 if(result.message.length>(result.state==='question'?4000:11500)||result.screenshots.length>5)throw new Error('Codex returned an oversized task result');
 return {...result,message:result.message.trim()};
}
