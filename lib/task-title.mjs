export const PENDING_TASK_TITLE='Формируем название…';
export function validateTaskTitle(value,description){
 if(typeof value!=='string')throw new Error('Invalid task title');
 const title=value.trim();
 if(!title||title.length>80||/[\r\n]/.test(title)||title===PENDING_TASK_TITLE||title===description.trim())throw new Error('Invalid task title');
 return title;
}
