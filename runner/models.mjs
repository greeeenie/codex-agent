export async function readModels(client){
 const models=[];let cursor;
 do{const page=await client.call('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});
  for(const m of page.data)if(!m.hidden)models.push({id:m.model,name:m.displayName,efforts:(m.supportedReasoningEfforts??[]).map(e=>e.reasoningEffort),defaultEffort:m.defaultReasoningEffort??null,isDefault:!!m.isDefault,inputModalities:m.inputModalities??['text','image']});
  cursor=page.nextCursor;
 }while(cursor);
 return models.slice(0,100);
}
