import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedAnalysisSnapshot,writeAnalysisSnapshot,readAnalysisSnapshot,createAnalysisAdmission,AnalysisBusyError} from './analysisCache';
import {AnalysisResults} from './analysisResults';
import {AggregateResults} from './aggregateResults';
const snapshot=()=>({analysis:new AnalysisResults(),overall:new AggregateResults(new Map()).toJSON(),bytes:1024});
test('concurrent identical analysis builds share one result, distinct revisions rebuild',async()=>{
 let builds=0;const build=async()=>{builds++;await new Promise(resolve=>setTimeout(resolve,5));return snapshot();};
 const [a,b]=await Promise.all([sharedAnalysisSnapshot('viewer:public:revision1',build),sharedAnalysisSnapshot('viewer:public:revision1',build)]);
 assert.equal(builds,1);assert.equal(a,b);await sharedAnalysisSnapshot('viewer:public:revision2',build);assert.equal(builds,2);
 await sharedAnalysisSnapshot('viewer:page-managed:revision1',build);assert.equal(builds,3);
});
test('failed analysis construction is retriable and bounded LRU evicts old snapshots',async()=>{
 await assert.rejects(sharedAnalysisSnapshot('failed',async()=>{throw Error('database unavailable');}));
 assert.ok(await sharedAnalysisSnapshot('failed',async()=>snapshot()));
 for(let i=0;i<16;i++)writeAnalysisSnapshot('bounded-'+i,{...snapshot(),bytes:3*1024*1024});
 assert.equal(readAnalysisSnapshot('bounded-0'),undefined);assert.ok(readAnalysisSnapshot('bounded-15'));
});

test('an identical in-flight build remains shared at pending capacity',async()=>{
 let release!:()=>void,builds=0;const hold=new Promise<void>(resolve=>release=resolve);
 const build=async()=>{builds++;await hold;return snapshot();};
 const pending=Array.from({length:24},(_,i)=>sharedAnalysisSnapshot('saturation-'+i,build));
 const duplicate=sharedAnalysisSnapshot('saturation-0',build);
 assert.equal(builds,24);release();const values=await Promise.all([...pending,duplicate]);assert.equal(values[0],values[24]);
});

test('analysis admission keeps queued authorization outside transactions, in FIFO order',async()=>{
 const admit=createAnalysisAdmission(2,4,1000),releases:Array<()=>void>=[],started:number[]=[],done:Promise<number>[]=[];
 let active=0,peak=0,permission=true;
 for(let i=0;i<6;i++)done.push(admit(async()=>{started.push(i);active++;peak=Math.max(peak,active);try{assert.equal(permission,i<2);await new Promise<void>(resolve=>releases.push(resolve));return i;}finally{active--;}}));
 assert.deepEqual(started,[0,1]);permission=false;
 for(let i=0;i<6;i++){releases[i]();await Promise.resolve();await Promise.resolve();await Promise.resolve();}
 assert.deepEqual(await Promise.all(done),[0,1,2,3,4,5]);assert.equal(peak,2);assert.deepEqual(started,[0,1,2,3,4,5]);
});
test('analysis queue bounds, expiry and failed builders release capacity',async()=>{
 const admit=createAnalysisAdmission(1,1,15);let release!:()=>void,unauthorizedStarts=0;
 const held=admit(async()=>{await new Promise<void>(resolve=>release=resolve);throw Error('database failed');});
 const failed=assert.rejects(held,/database failed/);
 const queued=admit(async()=>{unauthorizedStarts++;});
 const expired=assert.rejects(queued,AnalysisBusyError);
 await assert.rejects(admit(async()=>{unauthorizedStarts++;}),AnalysisBusyError);
 await expired;assert.equal(unauthorizedStarts,0);release();await failed;
 assert.equal(await admit(async()=>42),42);
});
