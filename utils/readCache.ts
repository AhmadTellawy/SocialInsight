type Snapshot = {body:string; status:number; headers:[string,string][]; at:number};
type Pending = {controller:AbortController; promise:Promise<Snapshot>; consumers:number};
const entries = new Map<string,Snapshot>();
const requests = new Map<string,Pending>();
const MAX_BYTES = 8 * 1024 * 1024;
let bytes = 0;
let scope = '';
export function cancelReadRequests(matches:(key:string)=>boolean){for(const [key,pending] of requests)if(matches(key)){pending.controller.abort();requests.delete(key);}}
export function invalidateReads(matches: (key:string) => boolean = () => true) {
  for (const [key,entry] of entries) if (matches(key)) { bytes-=entry.body.length*2; entries.delete(key); }
  for (const [key,pending] of requests) if (matches(key)) { pending.controller.abort(); requests.delete(key); }
}
export function peekRead<T>(key:string,ttl=20000):T|undefined {
  const entry=entries.get(key);if(!entry || Date.now()-entry.at>=ttl)return undefined;
  try{return JSON.parse(entry.body) as T;}catch{return undefined;}
}
export function seedRead(key:string,value:unknown){
  const body=JSON.stringify(value);if(body.length*2>MAX_BYTES/2)return;
  bytes-=(entries.get(key)?.body.length||0)*2;entries.delete(key);entries.set(key,{body,status:200,headers:[['content-type','application/json']],at:Date.now()});bytes+=body.length*2;
  while(entries.size>96||bytes>MAX_BYTES){const oldest=entries.keys().next().value!;bytes-=entries.get(oldest)!.body.length*2;entries.delete(oldest);}
}
export function setReadScope(next:string) { if (next !== scope) { scope=next; invalidateReads(); } }
const aborted = () => new DOMException('Request cancelled','AbortError');
const response = (value:Snapshot) => new Response(value.body,{status:value.status,headers:value.headers});
export async function cachedRead(key:string,ttl:number,load:(signal:AbortSignal)=>Promise<Response>,signal?:AbortSignal|null):Promise<Response> {
  if (signal?.aborted) throw aborted();
  const entry=entries.get(key);
  if (entry && Date.now()-entry.at < ttl) { entries.delete(key); entries.set(key,entry); return response(entry); }
  let pending=requests.get(key);
  if(pending?.controller.signal.aborted){requests.delete(key);pending=undefined;}
  if (!pending) {
    const controller=new AbortController();
    const promise=load(controller.signal).then(async res => {
      const body=res.headers.get('content-type')?.includes('application/json') ? JSON.stringify(await res.json()) : await res.text();
      const value:Snapshot={body,status:res.status,headers:Array.from(res.headers.entries()),at:Date.now()};
      if (controller.signal.aborted) throw aborted();
      if (res.ok && value.body.length*2 < MAX_BYTES/2) {
        bytes -= (entries.get(key)?.body.length || 0)*2;
        entries.delete(key); entries.set(key,value); bytes+=value.body.length*2;
        while (entries.size>96 || bytes>MAX_BYTES) { const oldest=entries.keys().next().value!; bytes-=entries.get(oldest)!.body.length*2; entries.delete(oldest); }
      }
      return value;
    }).finally(() => { if (requests.get(key)?.controller === controller) requests.delete(key); });
    pending={controller,promise,consumers:0}; requests.set(key,pending);
  }
  const shared=pending; shared.consumers++;
  return new Promise<Response>((resolve,reject) => {
    let done=false;
    const cleanup=() => { if(done)return false;done=true;signal?.removeEventListener('abort',cancel);shared.consumers--;return true; };
    const cancel=() => { if(!cleanup())return; if(!shared.consumers)shared.controller.abort();reject(aborted()); };
    signal?.addEventListener('abort',cancel,{once:true});
    shared.promise.then(value=>{if(cleanup())resolve(response(value));},error=>{if(cleanup())reject(error);});
  });
}
