/** @param {{status:string,executionStatus:string,finishedAt:number|null}} task */
export function isExecuting(task){return task.status==='running'&&!task.finishedAt&&['idle','running','waiting'].includes(task.executionStatus);}

/** Return the persisted destination; only the runner can enter active execution.
 * @param {{status:string,executionStatus:string,finishedAt:number|null}} task
 * @param {string} target
 */
export function moveTarget(task,target){
 if(task.status===target)return target;
 if(isExecuting(task))return null;
 if(task.status==='archived')return target==='done'?'done':null;
 if(target==='backlog'||target==='queued')return target;
 if(target==='running')return 'queued';
 if(target==='done'&&task.status==='review')return 'done';
 if(target==='review'&&task.status==='done')return 'review';
 return null;
}
