import {API_BASE_URL,authFetch,getAuthSessionIdentity} from './api';
import {interactionGeneration,subscribeInteractions} from '../utils/interactionCache';
type View={url:string|null;failed:boolean};
type Entry={key:string;id:string;source:string;width:number;actor:string|null;generation:number;url:string|null;bytes:number;checked:number;view:View;listeners:Set<(view:View)=>void>;controller?:AbortController;releaseAt:number};
const entries=new Map<string,Entry>();
const checks=new Map<string,Promise<void>>();
let installed=false;
const publish=(entry:Entry,view:View)=>{entry.view=view;entry.listeners.forEach(listener=>listener(view));};
const discard=(entry:Entry)=>{entry.controller?.abort();if(entry.url)URL.revokeObjectURL(entry.url);entry.url=null;entry.bytes=0;publish(entry,{url:null,failed:false});entries.delete(entry.key);};
const clear=()=>{entries.forEach(discard);checks.clear();};
function validSource(source:string) {
  const url=new URL(source,window.location.origin),api=new URL(API_BASE_URL,window.location.origin);
  return (source.startsWith('/api/media/') && url.origin===window.location.origin) || (url.origin===api.origin && url.pathname.startsWith(api.pathname.replace(/\/$/,'')+'/media/'));
}
async function load(entry:Entry,reauthorize=false) {
  if(entry.controller || !entry.listeners.size || document.hidden)return;
  const controller=new AbortController();entry.controller=controller;
  const valid=()=>!controller.signal.aborted && entry.actor===getAuthSessionIdentity() && entry.generation===interactionGeneration();
  try {
    if(!validSource(entry.source))throw Error('Invalid media source');
    if(entry.url && (reauthorize || Date.now()-entry.checked>=30000)) {
      const key=JSON.stringify([entry.actor,entry.generation,entry.id]);
      if(!checks.has(key))checks.set(key,authFetch('/api/media/'+encodeURIComponent(entry.id),{cache:'no-store',timeoutMs:15000}).then(async response=>{
        if(!response.ok)throw Error('Media unavailable');const dto=await response.json();
        if(!dto.requiresAuth || dto.src!==entry.source)throw Error('Media changed');
      }).finally(()=>checks.delete(key)));
      await checks.get(key);
    }
    if(!entry.url){
      const url=entry.source+(entry.source.includes('?')?'&':'?')+'width='+entry.width;
      const response=await authFetch(url,{signal:controller.signal,cache:'no-store',timeoutMs:20000});
      if(!response.ok || !response.headers.get('content-type')?.startsWith('image/'))throw Error('Media unavailable');
      const blob=await response.blob();if(!valid())return;
      entry.url=URL.createObjectURL(blob);entry.bytes=blob.size;
    }
    if(!valid())return;
    entry.checked=Date.now();publish(entry,{url:document.hidden?null:entry.url,failed:false});
  }catch{if(valid()){if(entry.url)URL.revokeObjectURL(entry.url);entry.url=null;entry.bytes=0;publish(entry,{url:null,failed:true});}}
  finally{if(entry.controller===controller)entry.controller=undefined;}
}
function install(){
 if(installed)return;installed=true;
 let epoch=interactionGeneration();
 subscribeInteractions(()=>{const next=interactionGeneration();if(next!==epoch){epoch=next;clear();}});
 const refresh=()=>entries.forEach(entry=>{if(entry.actor!==getAuthSessionIdentity()){discard(entry);return;}publish(entry,{url:null,failed:false});if(!document.hidden)void load(entry,true);});
 window.addEventListener('auth_expired',clear);window.addEventListener('storage',event=>{if(!event.key||event.key==='si_user')clear();});
 window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
 window.setInterval(()=>{
   const now=Date.now();let bytes=Array.from(entries.values()).reduce((n,e)=>n+e.bytes,0);
   entries.forEach(entry=>{
     if(!entry.listeners.size && (now-entry.releaseAt>30000 || bytes>12*1024*1024 || entries.size>120)){bytes-=entry.bytes;discard(entry);}
     else if(entry.listeners.size && now-entry.checked>=30000)void load(entry,true);
   });
 },5000);
}
export function acquireProtectedImage(id:string,source:string,width:number,listener:(view:View)=>void){
 install();const actor=getAuthSessionIdentity(),generation=interactionGeneration(),key=JSON.stringify([actor,generation,id,source,width]);
 let entry=entries.get(key);
 if(!entry){entry={key,id,source,width,actor,generation,url:null,bytes:0,checked:0,view:{url:null,failed:false},listeners:new Set(),releaseAt:0};entries.set(key,entry);}
 const resource=entry;resource.listeners.add(listener);
 if(Date.now()-resource.checked>=30000 || document.hidden)publish(resource,{url:null,failed:false});
 listener(resource.view);void load(resource);
 return()=>{resource.listeners.delete(listener);resource.releaseAt=Date.now();if(!resource.listeners.size){resource.controller?.abort();resource.controller=undefined;}};
}
export function imageRequestWidth(displayWidth:number,dpr=1){return [64,128,256,512,768,1080,1500].find(width=>width>=displayWidth*Math.min(3,Math.max(1,dpr)))||1500;}
