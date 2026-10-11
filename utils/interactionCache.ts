/** Short-lived, memory-only read cache. Never serialize private content to storage. */
export type InteractionPage<T> = { items: T[]; nextCursor: string | null; totalCount?: number };
export type InteractionEntry<T> = InteractionPage<T> & { updatedAt: number; version: number };
const entries = new Map<string, InteractionEntry<any>>();
const sizes=new Map<string,number>();let bytes=0;
const forget=(key:string)=>{bytes-=sizes.get(key)||0;sizes.delete(key);entries.delete(key);};
const listeners = new Set<() => void>();
let generation = 0;
let nextVersion = 0;
const revisions = new Map<string, number>();
function trimRevisions() {
  if(revisions.size<=240)return;
  for(const key of revisions.keys()) {
    if(!entries.has(key) && !Array.from(requests.values()).some(request=>request.key===key)) revisions.delete(key);
    if(revisions.size<=160)break;
  }
}
export const interactionVersion = (key: string) => revisions.get(key) || 0;
export const interactionKey = (viewer: string | undefined | null, kind: string, id: string) =>
  JSON.stringify([viewer || 'guest', kind, id]);
export const interactionGeneration = () => generation;
export const subscribeInteractions = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const emit = () => listeners.forEach(listener => listener());
export const readInteraction = <T>(key: string): InteractionEntry<T> | undefined => entries.get(key);
export const freshInteraction = <T>(key: string): InteractionEntry<T> | undefined => {
  const entry = readInteraction<T>(key);
  return entry && Date.now() - entry.updatedAt < 30_000 ? entry : undefined;
};
export const writeInteraction = <T>(key: string, page: InteractionPage<T>) => {
  const version = ++nextVersion;
  revisions.set(key, version);
  forget(key);
  const size=JSON.stringify(page).length*2;sizes.set(key,size);bytes+=size;
  entries.set(key, { ...page, version, updatedAt: Date.now() });
  while (entries.size > 80 || bytes>16*1024*1024) forget(entries.keys().next().value!);
  trimRevisions();
  emit();
};
export const evictInteraction = (key: string) => { forget(key);for(const [id,request] of requests){if(request.key===key){request.controller.abort();requests.delete(id);}} revisions.set(key, ++nextVersion); trimRevisions(); emit(); };
export const clearInteractions = () => { entries.clear(); sizes.clear(); bytes=0; revisions.clear(); generation++; cancelInteractionReads(); emit(); };

/** A fresh feed/detail read can refresh cached counts, but an older read must
 * never roll back a comment mutation confirmed while that read was in flight. */
export const captureInteractionVersions = () => ({ generation, versions: new Map(Array.from(entries, ([key, entry]) => [key, entry.version])) });
export function reconcilePostCommentCounts(viewer: string | undefined, posts: any[], snapshot: ReturnType<typeof captureInteractionVersions>) {
  if (snapshot.generation !== generation) return;
  let changed = false;
  const apply = (post: any) => {
    if (!post) return;
    const key = interactionKey(viewer, 'comments', post.id);
    const entry = entries.get(key);
    if (entry && entry.version === snapshot.versions.get(key) && Number.isInteger(post.commentsCount) && post.commentsCount >= 0 && post.commentsCount !== entry.totalCount) {
      const version=++nextVersion; revisions.set(key,version);
      entries.set(key, { ...entry, totalCount: post.commentsCount, version });
      changed = true;
    }
    if (post.sharedFrom) apply(post.sharedFrom);
  };
  posts.forEach(apply);
  if (changed) emit();
}

const requests = new Map<string, { key: string; controller: AbortController; promise: Promise<void>; consumers:number }>();
/** One request per viewer/resource/cursor. Consumer unmounts do not cancel other consumers. */
export function loadInteraction<T extends { id: string }>(key: string, cursor: string | null,
  loader: (signal: AbortSignal) => Promise<InteractionPage<T>>,signal?:AbortSignal) {
  if(signal?.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'));
  const requestKey = JSON.stringify([key, cursor]);
  const existing = requests.get(requestKey);
  if (existing && !existing.controller.signal.aborted) return consume(existing,signal);
  const controller = new AbortController();
  const epoch = generation;
  const version = interactionVersion(key);
  const promise = loader(controller.signal).then(page => {
    if (controller.signal.aborted || epoch !== generation || interactionVersion(key) !== version) return;
    const previous = readInteraction<T>(key);
    const items = Array.from(new Map([...(cursor ? previous?.items || [] : []), ...page.items].map(row => [row.id, row])).values());
    writeInteraction(key, { ...page, items });
  }).finally(() => { if (requests.get(requestKey)?.controller === controller) requests.delete(requestKey); });
  const pending={key,controller,promise,consumers:0};
  requests.set(requestKey,pending);
  return consume(pending,signal);
}
export function cancelInteractionReads() { requests.forEach(r => r.controller.abort()); requests.clear(); }

function consume(pending:{controller:AbortController;promise:Promise<void>;consumers:number},signal?:AbortSignal){
 pending.consumers++;
 return new Promise<void>((resolve,reject)=>{
   let done=false;
   const finish=()=>{if(done)return false;done=true;pending.consumers--;signal?.removeEventListener('abort',abort);return true;};
   const abort=()=>{if(!finish())return;if(!pending.consumers)pending.controller.abort();reject(new DOMException('Cancelled','AbortError'));};
   signal?.addEventListener('abort',abort,{once:true});
   pending.promise.then(()=>{if(finish())resolve();},error=>{if(finish())reject(error);});
 });
}
