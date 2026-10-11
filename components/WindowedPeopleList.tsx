import React, {useLayoutEffect,useRef,useState} from 'react';

// People rows have a reserved 72px frame; long names truncate inside that frame.
// Keep the full scroll extent while bounding expensive avatar/component mounts.
export function WindowedPeopleList<T>({items,itemKey,children}:{items:T[];itemKey:(item:T)=>string;children:(item:T,index:number)=>React.ReactNode}) {
  const root=useRef<HTMLDivElement>(null);
  const [range,setRange]=useState({start:0,end:24});
  const [focused,setFocused]=useState<number|null>(null);
  const virtual=items.length>100, height=72;
  useLayoutEffect(()=>{
    const element=root.current, scroller=element?.closest<HTMLElement>('.overflow-y-auto');
    if(!element||!scroller||!virtual)return;
    let frame=0;
    const update=()=>{const offset=element.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop;
      const start=Math.max(0,Math.floor((scroller.scrollTop-offset)/height)-6);
      const end=Math.min(items.length,Math.max(start+1,Math.ceil((scroller.scrollTop-offset+scroller.clientHeight)/height)+6));
      setRange(old=>old.start===start&&old.end===end?old:{start,end});};
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(update);};
    const observer=new ResizeObserver(schedule);observer.observe(scroller);scroller.addEventListener('scroll',schedule,{passive:true});update();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();scroller.removeEventListener('scroll',schedule);};
  },[items.length,virtual]);
  const indices=virtual?Array.from({length:Math.max(0,range.end-range.start)},(_,i)=>range.start+i):items.map((_,i)=>i);
  if(virtual&&focused!==null&&focused<items.length&&!indices.includes(focused))indices.push(focused);
  const keyDown=(event:React.KeyboardEvent,index:number)=>{
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:Math.max(0,Math.min(items.length-1,index+(event.key==='ArrowDown'?1:-1)));
    setFocused(next);
    const element=root.current,scroller=element?.closest<HTMLElement>('.overflow-y-auto');
    if(element&&scroller){const offset=element.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop;scroller.scrollTop=offset+next*height;}
    requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>('[data-person-index="'+next+'"] button')?.focus({preventScroll:true}));
  };
  return <div ref={root} role="list" style={virtual?{height:items.length*height,position:'relative'}:undefined}>
    {indices.map(index=>items[index]&&<div key={itemKey(items[index])} role="listitem" aria-posinset={index+1} aria-setsize={items.length}
      data-person-index={index} onFocus={()=>setFocused(index)} onKeyDown={event=>keyDown(event,index)}
      style={virtual?{position:'absolute',top:index*height,height,width:'100%'}:{height}}>{children(items[index],index)}</div>)}
  </div>;
}
