import { useEffect, useState } from 'react';
import { pageRequest } from '../services/pagesApi';
import { Survey } from '../types';

type Entry={id:string;management:boolean;set:(allowed:boolean)=>void};
const entries=new Set<Entry>();let timer:ReturnType<typeof setInterval>|undefined;let inFlight=false;let recheckRequested=false;
async function verify(){
  if(document.visibilityState!=='visible')return;
  if(inFlight){recheckRequested=true;return;}
  inFlight=true;
  const active=[...entries];
  try{for(let offset=0;offset<active.length;offset+=50){const batch=active.slice(offset,offset+50);
    try{const result=await pageRequest<{allowed:string[]}>('/content-access','POST',{items:batch.map(({id,management})=>({id,management}))});const allowed=new Set(result.allowed);batch.forEach(entry=>{if(entries.has(entry))entry.set(allowed.has(entry.id+':'+(entry.management?'management':'public')));});}
    catch{batch.forEach(entry=>{if(entries.has(entry))entry.set(false);});}
  }}finally{inFlight=false;if(recheckRequested){recheckRequested=false;queueMicrotask(()=>void verify());}}
}
function focus(){entries.forEach(entry=>entry.set(false));void verify();}
function visibility(){if(document.visibilityState==='visible')focus();}

/** One bounded revalidation queue shared by every mounted Page card; never persists content. */
export function usePageContentAccess(post:Survey,userId?:string,management=false){
  const isPage=!!post.pageId||!!post.sharedFrom?.pageId;
  const key=post.id+':'+(userId||'guest')+':'+management;
  const [receipt,setReceipt]=useState({key:'',allowed:false});
  useEffect(()=>{
    if(!isPage)return;
    setReceipt({key,allowed:false});
    const entry={id:post.id,management,set:(allowed:boolean)=>setReceipt({key,allowed})};entries.add(entry);
    if(!timer){timer=setInterval(()=>void verify(),30000);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visibility);}
    void verify();
    return()=>{entries.delete(entry);if(!entries.size){clearInterval(timer);timer=undefined;window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visibility);}};
  },[post.id,isPage,userId,management,key]);
  return !isPage||(receipt.key===key&&receipt.allowed);
}
