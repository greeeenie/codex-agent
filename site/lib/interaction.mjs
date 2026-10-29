export const interactionMethods=new Set(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','item/tool/requestUserInput','tool/requestUserInput','mcpServer/elicitation/request']);
export function interactionPrompt(method,p={}){
 if(method==='item/commandExecution/requestApproval')return [p.networkApprovalContext?`Разрешить подключение к ${p.networkApprovalContext.host}?`:'Разрешить выполнение команды?',p.reason,p.command].filter(Boolean).join('\n').slice(0,4000);
 if(method==='item/fileChange/requestApproval')return ['Разрешить изменение файлов?',p.reason,p.grantRoot].filter(Boolean).join('\n').slice(0,4000);
 if(method==='item/permissions/requestApproval')return ['Codex запрашивает дополнительные разрешения.',p.reason,JSON.stringify(p.permissions??{})].filter(Boolean).join('\n').slice(0,4000);
 return String(p.message??p.questions?.map(q=>q.question).join('\n')??p.question??'Codex ожидает вашего ответа').slice(0,4000);
}
export function validateForm(schema,value,path='Ответ'){
 if(!schema||typeof schema!=='object')throw new Error('Форма не содержит схему');
 if(schema.enum&&!schema.enum.some(v=>JSON.stringify(v)===JSON.stringify(value)))throw new Error(`${path}: выберите предложенный вариант`);
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${path}: ожидается объект`);
  for(const key of schema.required??[])if(value[key]===undefined)throw new Error(`${path}: заполните ${key}`);
  for(const [key,v] of Object.entries(value)){if(!Object.hasOwn(schema.properties??{},key))throw new Error(`${path}: неизвестное поле ${key}`);validateForm(schema.properties[key],v,`${path}.${key}`);}
 }else if(schema.type==='array'){if(!Array.isArray(value))throw new Error(`${path}: ожидается список`);value.forEach(v=>validateForm(schema.items,v,path));}
 else if(schema.type&&typeof value!==({'integer':'number'}[schema.type]??schema.type))throw new Error(`${path}: неверный тип`);
 if(schema.type==='integer'&&!Number.isInteger(value))throw new Error(`${path}: введите целое число`);
 if(typeof value==='number'&&((schema.minimum!==undefined&&value<schema.minimum)||(schema.maximum!==undefined&&value>schema.maximum)))throw new Error(`${path}: число вне диапазона`);
 if(typeof value==='string'&&((schema.minLength!==undefined&&value.length<schema.minLength)||(schema.maxLength!==undefined&&value.length>schema.maxLength)))throw new Error(`${path}: проверьте длину текста`);
 return value;
}
export function interactionReply(question,answer){
 const p=question.params??{},method=question.method;
 if(method==='structured-question')return {text:answer};
 const a=JSON.parse(answer);if(!a||!['accept','decline','cancel'].includes(a.decision))throw new Error('Выберите решение');
 if(method==='item/commandExecution/requestApproval'||method==='item/fileChange/requestApproval')return {decision:a.decision};
 if(method==='item/permissions/requestApproval')return {permissions:a.decision==='accept'?(p.permissions??{}):{},scope:'turn'};
 if(method==='mcpServer/elicitation/request')return {action:a.decision,content:a.decision==='accept'&&p.mode!=='url'?validateForm(p.requestedSchema,a.values??{}):null};
 if(method==='item/tool/requestUserInput'||method==='tool/requestUserInput'){
  const answers={};for(const q of p.questions??[]){const value=a.values?.[q.id];if(a.decision==='accept'&&(!Array.isArray(value)||!value.length||value.some(v=>typeof v!=='string'||!v.trim())))throw new Error(`Ответьте на вопрос: ${q.question}`);answers[q.id]={answers:a.decision==='accept'?value:[]};}return {answers};
 }
 throw new Error('Этот тип запроса пока не поддерживается. Откройте контекст в Codex.');
}
