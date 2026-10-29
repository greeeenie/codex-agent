export type Draft={title:string;description:string;model:string|null;effort:string|null;attachmentKeys:string[];updatedAt:number};
const key=(id:string)=>`codex-hub:draft:${id}`;
export function readDraft(id:string):Draft|null{try{return JSON.parse(localStorage.getItem(key(id))??'null');}catch{return null;}}
export function writeDraft(id:string,draft:Draft){localStorage.setItem(key(id),JSON.stringify(draft));}
export function removeDraft(id:string){localStorage.removeItem(key(id));void fileDraft(id,[]);}
export async function fileDraft(id:string,files?:File[]):Promise<File[]>{
 return new Promise((resolve,reject)=>{const request=indexedDB.open('codex-hub-drafts',1);request.onupgradeneeded=()=>request.result.createObjectStore('files');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('files',files?'readwrite':'readonly'),store=tx.objectStore('files'),op=files?store.put(files,id):store.get(id);op.onsuccess=()=>resolve(files??op.result??[]);op.onerror=()=>reject(op.error);tx.oncomplete=()=>db.close();};});
}
