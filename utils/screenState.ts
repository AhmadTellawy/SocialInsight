import {interactionGeneration,subscribeInteractions} from './interactionCache';
const states=new Map<string,unknown>();let epoch=interactionGeneration();
subscribeInteractions(()=>{if(epoch!==interactionGeneration()){epoch=interactionGeneration();states.clear();}});
export function readScreenState<T>(key:string):T|undefined{return states.get(key) as T|undefined;}
export function saveScreenState<T>(key:string,value:T){states.delete(key);states.set(key,value);while(states.size>100)states.delete(states.keys().next().value!);}
