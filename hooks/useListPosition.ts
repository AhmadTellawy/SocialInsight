import {useCallback,useLayoutEffect,useRef} from 'react';
import {readScreenState,saveScreenState} from '../utils/screenState';
/** Coordinates only. Restoring never supplies or authorizes list data. */
export function useListPosition(key:string,enabled=true) {
  const cleanup=useRef<()=>void>(()=>{});
  const ref=useCallback((element:HTMLDivElement|null)=>{
    cleanup.current();cleanup.current=()=>{};
    if(!element || !enabled)return;
    const storageKey='list-position:'+key;
    const top=readScreenState<number>(storageKey)||0;
    let restoring=true;
    const apply=()=>{if(restoring)element.scrollTop=top;};
    const capture=()=>{if(!restoring || Math.abs(element.scrollTop-top)<=8){restoring=false;saveScreenState(storageKey,element.scrollTop);}};
    const interact=()=>{restoring=false;};
    const observer=new MutationObserver(apply);observer.observe(element,{subtree:true,childList:true});
    apply();element.addEventListener('scroll',capture,{passive:true});element.addEventListener('pointerdown',interact);element.addEventListener('wheel',interact,{passive:true});element.addEventListener('keydown',interact);
    cleanup.current=()=>{if(!restoring)saveScreenState(storageKey,element.scrollTop);observer.disconnect();element.removeEventListener('scroll',capture);element.removeEventListener('pointerdown',interact);element.removeEventListener('wheel',interact);element.removeEventListener('keydown',interact);};
  },[key,enabled]);
  useLayoutEffect(()=>()=>cleanup.current(),[]);
  return ref;
}
