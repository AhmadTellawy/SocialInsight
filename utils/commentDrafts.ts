import {interactionGeneration,subscribeInteractions} from './interactionCache';
export type CommentDraft={text:string;parentId:string|null;official:boolean;editingId:string|null;mutationId?:string;fingerprint?:string};
const drafts=new Map<string,CommentDraft>();let epoch=interactionGeneration();
subscribeInteractions(()=>{if(epoch!==interactionGeneration()){epoch=interactionGeneration();drafts.clear();}});
export const readCommentDraft=(key:string)=>drafts.get(key);
export function saveCommentDraft(key:string,draft:CommentDraft){drafts.delete(key);drafts.set(key,draft);while(drafts.size>40)drafts.delete(drafts.keys().next().value!);}
