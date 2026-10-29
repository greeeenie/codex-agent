'use client';
import {useEffect,useRef,useState} from 'react';
import TaskComposer from './task-composer';
import {readDraft,writeDraft,removeDraft,fileDraft} from '../lib/drafts';
import type {ModelOption,Status} from '../lib/board-types';

type Props={projectId:string;models:ModelOption[];busy:boolean;focusKey:number;target:Status;onTarget:(target:Status)=>void;onCreate:(input:{description:string;model:string|null;effort:string|null},files:File[],target:Status)=>Promise<boolean>};
export default function QuickComposer(p:Props){
 const [value,setValue]=useState(''),[model,setModel]=useState<string|null>(null),[effort,setEffort]=useState<string|null>(null),[files,setFiles]=useState<File[]>([]),[submitting,setSubmitting]=useState(false);
 const ready=useRef(false),sequence=useRef(0),dock=useRef<HTMLDivElement>(null),draftId=`new:${p.projectId}`;
 useEffect(()=>{if(!dock.current)return;const observer=new ResizeObserver(entries=>document.documentElement.style.setProperty('--composer-space',Math.ceil(entries[0].contentRect.height+40)+'px'));observer.observe(dock.current);return()=>{observer.disconnect();document.documentElement.style.removeProperty('--composer-space');};},[]);
 useEffect(()=>{const seq=++sequence.current;ready.current=false;const draft=readDraft(draftId);setValue(draft?.description??'');setModel(draft?.model??null);setEffort(draft?.effort??null);setFiles([]);void fileDraft(draftId).then(files=>{if(sequence.current===seq){setFiles(files);ready.current=true;}}).catch(()=>{if(sequence.current===seq)ready.current=true;});return()=>{sequence.current++;};},[draftId]);
 useEffect(()=>{if(ready.current&&p.projectId){writeDraft(draftId,{title:'',description:value,model,effort,attachmentKeys:[],updatedAt:Date.now()});void fileDraft(draftId,files).catch(()=>{});}},[draftId,p.projectId,value,model,effort,files]);
 async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();if(!value.trim()||submitting||!p.projectId)return;setSubmitting(true);try{if(await p.onCreate({description:value.trim(),model,effort},files,p.target)){setValue('');setFiles([]);removeDraft(draftId);await fileDraft(draftId,[]);}}finally{setSubmitting(false);}}
 return <div className="quick-composer" ref={dock}><TaskComposer compact focusKey={p.focusKey} value={value} onChange={setValue} model={model} effort={effort} models={p.models} onModel={id=>{setModel(id);setEffort(p.models.find(m=>m.id===id)?.defaultEffort??null);}} onEffort={setEffort} files={files} onFiles={setFiles} attachments={[]} onRemoveAttachment={()=>{}} busy={p.busy||submitting||!p.projectId} editing={false} submitError="" onSubmit={e=>void submit(e)}><select className="composer-destination" aria-label="Куда добавить задачу" value={p.target==='queued'||p.target==='running'?'queued':'backlog'} onChange={e=>p.onTarget(e.target.value as Status)}><option value="backlog">Бэклог</option><option value="queued">В очередь</option></select></TaskComposer></div>;
}
