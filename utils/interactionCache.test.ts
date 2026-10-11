import assert from 'node:assert/strict';
import test from 'node:test';
import { loadInteraction, captureInteractionVersions, reconcilePostCommentCounts, clearInteractions, evictInteraction, freshInteraction, interactionGeneration, interactionKey, readInteraction, writeInteraction } from './interactionCache.ts';

test('comments are isolated by account and post, and session reset invalidates in-flight generations', () => {
  clearInteractions();
  const first = interactionKey('a', 'comments', 'post');
  const other = interactionKey('b', 'comments', 'post');
  writeInteraction(first, { items: [{ id: 'private' }], totalCount: 1, nextCursor: null });
  assert.equal(readInteraction(other), undefined);
  const generation = interactionGeneration(); clearInteractions();
  assert.equal(readInteraction(first), undefined); assert.notEqual(generation, interactionGeneration());
});
test('confirmed mutations advance version and revocation removes cached content/count together', () => {
  const key = interactionKey('a', 'comments', 'p');
  writeInteraction(key, { items: [], totalCount: 0, nextCursor: null });
  const requestVersion = readInteraction(key)?.version;
  writeInteraction(key, { items: [{ id: 'saved' }], totalCount: 1, nextCursor: null });
  assert.notEqual(requestVersion, readInteraction(key)?.version);
  evictInteraction(key); assert.equal(readInteraction(key), undefined);
});
test('only fresh pages qualify for instant reopen', () => {
  const key = interactionKey('a', 'comments', 'p');
  writeInteraction(key, { items: [], totalCount: 0, nextCursor: null });
  assert.ok(freshInteraction(key));
  readInteraction(key)!.updatedAt = Date.now() - 30_001;
  assert.equal(freshInteraction(key), undefined);
});

test('fresh post counts reconcile without letting late reads erase confirmed mutations', () => {
  clearInteractions(); const key = interactionKey('a', 'comments', 'p');
  writeInteraction(key, { items: [], totalCount: 1, nextCursor: null });
  const oldRead = captureInteractionVersions();
  writeInteraction(key, { items: [{ id: 'saved' }], totalCount: 2, nextCursor: null });
  reconcilePostCommentCounts('a', [{ id: 'p', commentsCount: 1 }], oldRead);
  assert.equal(readInteraction(key)?.totalCount, 2);
  const freshRead = captureInteractionVersions();
  reconcilePostCommentCounts('a', [{ id: 'p', commentsCount: 3 }], freshRead);
  assert.equal(readInteraction(key)?.totalCount, 3);
  assert.deepEqual(readInteraction(key)?.items, [{ id: 'saved' }]);
  clearInteractions(); writeInteraction(key, { items: [], totalCount: 5, nextCursor: null });
  reconcilePostCommentCounts('a', [{ id: 'p', commentsCount: 3 }], freshRead);
  assert.equal(readInteraction(key)?.totalCount, 5);
});

test('late list read cannot replace a confirmed write and two consumers share one request',async()=>{
 clearInteractions();const key=interactionKey('viewer','likes','post');let resolve!:(value:any)=>void,calls=0;
 const loader=async()=>{calls++;return new Promise<any>(done=>{resolve=done;});};
 const a=loadInteraction(key,null,loader),b=loadInteraction(key,null,loader);
 writeInteraction(key,{items:[{id:'confirmed'}],nextCursor:null,totalCount:1});resolve({items:[{id:'old'}],nextCursor:null,totalCount:1});await Promise.all([a,b]);
 assert.equal(calls,1);assert.equal(readInteraction<any>(key)?.items[0].id,'confirmed');
});
test('leaving one consumer preserves the other, account reset cancels all reads',async()=>{
 clearInteractions();const key=interactionKey('viewer','likes','post');let resolve!:(value:any)=>void,shared!:AbortSignal;
 const loader=async(signal:AbortSignal)=>{shared=signal;return new Promise<any>(done=>{resolve=done;});};
 const c=new AbortController(),a=loadInteraction(key,null,loader,c.signal),b=loadInteraction(key,null,loader);
 c.abort();await assert.rejects(a,{name:'AbortError'});assert.equal(shared.aborted,false);clearInteractions();assert.equal(shared.aborted,true);
 resolve({items:[{id:'old-account'}],nextCursor:null});await b;assert.equal(readInteraction(key),undefined);
});
