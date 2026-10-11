import test from 'node:test';
import assert from 'node:assert/strict';
import {cachedRead,invalidateReads,setReadScope} from './readCache.ts';
test('same resource coalesces; one cancelled reader leaves another alive; scope changes clear data',async()=>{
  setReadScope('a'); let calls=0;let resolve!:(r:Response)=>void;
  const loader=async()=>{calls++;return new Promise<Response>(r=>resolve=r);};
  const controller=new AbortController();const a=cachedRead('p',20000,loader,controller.signal);const b=cachedRead('p',20000,loader);
  controller.abort();await assert.rejects(a,{name:'AbortError'});resolve(new Response('{"value":1}'));assert.equal((await (await b).json()).value,1);
  await cachedRead('p',20000,loader);assert.equal(calls,1);
  setReadScope('b');const c=cachedRead('p',20000,async()=>{calls++;return new Response('{}');});await c;assert.equal(calls,2);invalidateReads();
});
test('invalidation rejects a late read instead of repopulating stale data',async()=>{
 let resolve!:(r:Response)=>void;const pending=cachedRead('late',20000,()=>new Promise(r=>resolve=r));invalidateReads();resolve(new Response('{}'));await assert.rejects(pending,{name:'AbortError'});
});

test('cache preserves JSON body transformations on the first read and cache hits',async()=>{
 invalidateReads();let reads=0;
 const loader=async()=>{reads++;const response=Response.json({avatar:'/uploads/avatar.png'});const json=response.json.bind(response);response.json=async()=>{const value=await json();return {...value,avatar:'https://api.example.invalid'+value.avatar};};return response;};
 for(let i=0;i<2;i++)assert.equal((await (await cachedRead('assets',20000,loader)).json()).avatar,'https://api.example.invalid/uploads/avatar.png');
 assert.equal(reads,1);invalidateReads();
});
