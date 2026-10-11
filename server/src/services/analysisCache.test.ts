import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedAnalysisSnapshot,writeAnalysisSnapshot,readAnalysisSnapshot} from './analysisCache';
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
