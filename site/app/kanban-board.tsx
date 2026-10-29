'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {DndContext,DragOverlay,MouseSensor,TouchSensor,KeyboardSensor,useSensor,useSensors,useDroppable,pointerWithin,closestCenter,defaultDropAnimationSideEffects,type DragOverEvent,type DragEndEvent,type CollisionDetection} from '@dnd-kit/core';
import {SortableContext,useSortable,verticalListSortingStrategy,sortableKeyboardCoordinates,defaultAnimateLayoutChanges} from '@dnd-kit/sortable';
import {CSS} from '@dnd-kit/utilities';
import {Plus,Loader2} from 'lucide-react';
import {moveTarget} from '../lib/board-moves.mjs';
import type {Task,Status} from '../lib/board-types';

export const lanes:{id:Status;name:string}[]=[{id:'backlog',name:'Бэклог'},{id:'queued',name:'В очереди'},{id:'running',name:'В работе'},{id:'review',name:'На проверке'},{id:'done',name:'Готово'}];
export const archiveLane={id:'archived' as Status,name:'Архив'};
export function taskTime(task:Task,now:number){const time=task.activityAt??task.finishedAt??task.createdAt,minutes=Math.max(0,Math.floor((now-time)/60000));return minutes<1?'Только что':minutes<60?`${minutes} мин назад`:minutes<1440?`${Math.floor(minutes/60)} ч назад`:minutes<2880?'Вчера, '+new Date(time).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):new Date(time).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});}
type Props={tasks:Task[];archived:boolean;loading:boolean;disabled:boolean;now:number;selectedId:string|null;onOpen:(task:Task)=>void;onCreate:(lane:Status)=>void;onContext:(task:Task,x:number,y:number)=>void;onMove:(id:string,status:Status,beforeId:string|null)=>Promise<boolean>;onDragging:(dragging:boolean)=>void};
function Face({task,now}:{task:Task;now:number}){return <><h3>{task.title}</h3><time dateTime={new Date(task.activityAt??task.finishedAt??task.createdAt).toISOString()}>{taskTime(task,now)}</time></>;}
function Card({task,now,selected,disabled,onOpen,onContext,reduced}:{task:Task;now:number;selected:boolean;disabled:boolean;onOpen:Props['onOpen'];onContext:Props['onContext'];reduced:boolean}){
 const {setNodeRef,attributes,listeners,transform,transition,isDragging}=useSortable({id:task.id,data:{lane:task.status,type:'card'},disabled,transition:reduced?null:{duration:200,easing:'cubic-bezier(.22,1,.36,1)'},animateLayoutChanges:args=>defaultAnimateLayoutChanges({...args,wasDragging:true})});
 return <button ref={setNodeRef} {...attributes} {...listeners} className={`task-card ${selected?'selected':''} ${isDragging?'is-dragging':''}`} style={{transform:CSS.Transform.toString(transform),transition}} onClick={()=>onOpen(task)} onContextMenu={e=>{e.preventDefault();onContext(task,e.clientX,e.clientY);}} onKeyDown={e=>{listeners?.onKeyDown?.(e);if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const r=e.currentTarget.getBoundingClientRect();onContext(task,r.left+20,r.top+20);}}} aria-label={task.title}><Face task={task} now={now}/></button>;
}
function Column({lane,cards,children,loading,disabled,onCreate}:{lane:{id:Status;name:string};cards:Task[];children:React.ReactNode;loading:boolean;disabled:boolean;onCreate:Props['onCreate']}){
 const {setNodeRef,isOver}=useDroppable({id:`lane:${lane.id}`,data:{lane:lane.id,type:'lane'}});
 return <section ref={setNodeRef} className={`lane lane-${lane.id} ${isOver?'is-over':''}`} aria-label={lane.name}><div className="lane-header"><div><h2>{lane.name}</h2><span className="lane-count">{cards.length}</span></div>{lane.id!=='archived'&&<button aria-label={`Добавить задачу: ${lane.name}`} disabled={disabled} onClick={()=>onCreate(lane.id)}><Plus size={18}/></button>}</div><SortableContext items={cards.map(t=>t.id)} strategy={verticalListSortingStrategy}><div className="lane-cards">{children}{loading&&<div className="lane-loading" aria-label="Загрузка задач"><Loader2 size={17} className="spin"/></div>}{!loading&&!cards.length&&<span className="empty-lane">Пока нет задач</span>}</div></SortableContext></section>;
}
function place(tasks:Task[],id:string,lane:Status,overId:string|undefined,after=false){const item=tasks.find(t=>t.id===id);if(!item)return tasks;const next=tasks.filter(t=>t.id!==id);let index=overId?next.findIndex(t=>t.id===overId):-1;if(index<0){const last=next.findLastIndex(t=>t.status===lane);index=last<0?next.length:last+1;}else if(after)index++;next.splice(index,0,{...item,status:lane});return next;}
export default function Kanban(p:Props){
 const [preview,setPreview]=useState<Task[]|null>(null),[active,setActive]=useState<Task|null>(null),[reduced,setReduced]=useState(false),[mounted,setMounted]=useState(false);
 const previewRef=useRef<Task[]|null>(null),original=useRef<Task[]>([]);
 useEffect(()=>{setMounted(true);const media=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReduced(media.matches);change();media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
 const sensors=useSensors(useSensor(MouseSensor,{activationConstraint:{distance:6}}),useSensor(TouchSensor,{activationConstraint:{delay:200,tolerance:6}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
 const collision:CollisionDetection=args=>{if(!args.pointerCoordinates)return closestCenter({...args,droppableContainers:args.droppableContainers.filter(c=>c.data.current?.type==='card'||!(previewRef.current??p.tasks).some(t=>t.status===c.data.current?.lane))});const hits=pointerWithin(args),cards=hits.filter(h=>!String(h.id).startsWith('lane:'));return cards.length?cards:hits;};
 function update(value:Task[]|null){previewRef.current=value;setPreview(value);}
 function cancel(){update(null);setActive(null);p.onDragging(false);}
 function over(e:DragOverEvent){if(!e.over)return;const current=previewRef.current??p.tasks,item=current.find(t=>t.id===e.active.id),lane=e.over.data.current?.lane as Status;if(!item||!lane||item.status===lane||!moveTarget(original.current.find(t=>t.id===item.id)??item,lane))return;const after=e.active.rect.current.translated?e.active.rect.current.translated.top>e.over.rect.top+e.over.rect.height/2:false;update(place(current,item.id,lane,String(e.over.id).startsWith('lane:')?undefined:String(e.over.id),after));}
 async function end(e:DragEndEvent){
  if(!e.over){cancel();return;}let current=previewRef.current??p.tasks;const item=current.find(t=>t.id===e.active.id),initial=original.current.find(t=>t.id===e.active.id),lane=e.over.data.current?.lane as Status;
  if(!item||!initial||!lane||!moveTarget(initial,lane)){cancel();return;}
  const overId=String(e.over.id),cards=current.filter(t=>t.status===lane),oldIndex=cards.findIndex(t=>t.id===item.id),overIndex=cards.findIndex(t=>t.id===overId);
  if(overId!==item.id)current=place(current,item.id,lane,overId.startsWith('lane:')?undefined:overId,oldIndex>=0&&overIndex>=0&&oldIndex<overIndex);
  const ordered=current.filter(t=>t.status===lane),index=ordered.findIndex(t=>t.id===item.id),beforeId=ordered[index+1]?.id??null;
  update(current);setActive(null);
  try{await p.onMove(item.id,lane,beforeId);}finally{update(null);p.onDragging(false);}
 }
 const tasks=preview??p.tasks;
 return <DndContext sensors={sensors} collisionDetection={collision} onDragStart={e=>{original.current=p.tasks;update(p.tasks);setActive(p.tasks.find(t=>t.id===e.active.id)??null);p.onDragging(true);}} onDragOver={over} onDragEnd={e=>void end(e)} onDragCancel={cancel} autoScroll={{threshold:{x:.15,y:.15},acceleration:8}} accessibility={{screenReaderInstructions:{draggable:'Чтобы переместить задачу, нажмите пробел, затем стрелки. Пробел — сохранить, Escape — отменить.'},announcements:{onDragStart:()=> 'Задача выбрана для перемещения.',onDragOver:({over})=>over?`Колонка ${[...lanes,archiveLane].find(l=>l.id===over.data.current?.lane)?.name??''}`:undefined,onDragEnd:()=> 'Перемещение завершено.',onDragCancel:()=> 'Перемещение отменено.'}}}>
  <div className={`kanban ${p.archived?'archive-board':''}`} aria-label="Канбан-доска">{(p.archived?[archiveLane]:lanes).map(lane=>{const cards=tasks.filter(t=>t.status===lane.id);return <Column key={lane.id} lane={lane} cards={cards} loading={p.loading} disabled={p.disabled} onCreate={p.onCreate}>{cards.map(t=><Card key={t.id} task={t} now={p.now} selected={p.selectedId===t.id} disabled={p.disabled} onOpen={p.onOpen} onContext={p.onContext} reduced={reduced}/>)}</Column>;})}</div>
  {mounted&&createPortal(<DragOverlay adjustScale={false} dropAnimation={reduced?null:{duration:200,easing:'cubic-bezier(.22,1,.36,1)',sideEffects:defaultDropAnimationSideEffects({styles:{active:{opacity:'0'}}})}}>{active&&<div className="task-card drag-overlay"><Face task={active} now={p.now}/></div>}</DragOverlay>,document.body)}
 </DndContext>;
}
