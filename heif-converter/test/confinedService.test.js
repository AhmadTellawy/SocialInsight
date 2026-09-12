import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { ConfinedHeifConverter } from '../src/confinedService.js';
import { createConverterServer } from '../src/server.js';
import { ServiceError } from '../src/errors.js';
import { bodySha256, signRequest } from '../src/auth.js';
import { heifFixture } from './fixtures.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const probe={ok:true,checks:Array(19).fill('synthetic'),syscallReport:{negativeSyscalls:31}};
const unavailable=()=>new ServiceError(503,'WORKER_CLEANUP_FAILED','Unavailable');
function fixture(overrides={}) {
  return new ConfinedHeifConverter({
    bootstrap:async()=>({resources:{memoryEventsPath:'/synthetic/events',oom:0,oomKill:0}}),
    checkRoot:async()=>{}, io:{readFile:async()=> 'oom 0\noom_kill 0\n'},
    runJob:async(_input,{probe:isProbe})=>isProbe?probe:{data:Buffer.from('webp'),mime:'image/webp',width:1,height:1},
    ...overrides,
  });
}

test('readiness requires a completed confined probe and refuses stale startup without spawning',async()=>{
  let calls=0;const service=fixture({bootstrap:async()=>{throw unavailable();},runJob:async()=>{calls++;}});
  assert.equal(service.isReady(),false);
  await assert.rejects(service.initialize(),e=>e.status===503);
  await assert.rejects(service.convert(Buffer.alloc(0)),e=>e.status===503);
  assert.equal(calls,0);
  await assert.rejects(fixture({runJob:async()=>({...probe,syscallReport:{negativeSyscalls:30}})}).initialize(),e=>e.status===503);
});

test('cleanup verification owns capacity; a failed cleanup latches readiness before later admission',async()=>{
  const cleaning=deferred(),release=deferred();let checks=0,calls=0;
  const service=fixture({checkRoot:async()=>{if(++checks===3){cleaning.resolve();await release.promise;throw unavailable();}},runJob:async(_input,{probe:isProbe})=>{calls++;return isProbe?probe:{};}});
  await service.initialize();
  const converting=service.convert(Buffer.alloc(0));
  const rejected=assert.rejects(converting,e=>e.status===503);
  await cleaning.promise;
  await assert.rejects(service.convert(Buffer.alloc(0)),e=>e.status===429);
  release.resolve();await rejected;
  assert.equal(service.isReady(),false);
  await assert.rejects(service.convert(Buffer.alloc(0)),e=>e.status===503);
  assert.equal(calls,2);
});

test('ordinary decode rejection recovers only after root and OOM checks, while OOM permanently disables service',async()=>{
  let oom=false;
  const service=fixture({io:{readFile:async()=>`oom ${oom?1:0}\noom_kill 0\n`},runJob:async(_input,{probe:isProbe})=>{if(isProbe)return probe;throw new ServiceError(422,'IMAGE_PROCESSING_FAILED','Invalid image');}});
  await service.initialize();
  await assert.rejects(service.convert(Buffer.alloc(0)),e=>e.status===422);
  assert.equal(service.isReady(),true);oom=true;
  await assert.rejects(service.convert(Buffer.alloc(0)),e=>e.status===503);
  assert.equal(service.isReady(),false);
});

test('shutdown aborts an active worker and waits for its cleanup before resolving',async()=>{
  const started=deferred(),aborted=deferred(),cleaned=deferred();
  const service=fixture({runJob:async(_input,{probe:isProbe,signal})=>{
    if(isProbe)return probe;started.resolve();
    await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
    aborted.resolve();await cleaned.promise;throw new ServiceError(499,'CONVERSION_CANCELLED','Cancelled');
  }});
  await service.initialize();const conversion=assert.rejects(service.convert(Buffer.alloc(0)),e=>e.status===503);
  await started.promise;let stopped=false;const stop=service.stop().then(()=>{stopped=true;});
  await aborted.promise;assert.equal(stopped,false);assert.equal(service.isReady(),false);
  cleaned.resolve();await Promise.all([conversion,stop]);assert.equal(stopped,true);
});

const secret='synthetic-http-test-key-at-least-32-bytes';
const config={hmacSecret:secret,signatureWindowSeconds:300,maxBodyBytes:15*1024*1024,maxAggregatePixels:40_000_000,maxConcurrency:1};
function headers(body,id){const timestamp=String(Math.floor(Date.now()/1000));return{'content-type':'application/octet-stream','content-length':String(body.length),'x-si-request-id':id,'x-si-timestamp':timestamp,'x-si-body-sha256':bodySha256(body),'x-si-signature':signRequest({secret,timestamp,requestId:id,body})};}
async function serve(converter,run){
  const server=createConverterServer({config,converter,healthEvidence:{status:'ready',protocolVersion:2},logger:{error(){}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await run(`http://127.0.0.1:${server.address().port}`);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

test('HTTP readiness and admission both fail closed after fatal service state',async()=>{
  const body=heifFixture();let ready=true,calls=0;
  await serve({isReady:()=>ready,convert:async()=>{calls++;ready=false;throw unavailable();}},async base=>{
    assert.equal((await fetch(base+'/health/ready')).status,200);
    assert.equal((await fetch(base+'/v1/convert',{method:'POST',body,headers:headers(body,'fatal_request_00000000001')})).status,503);
    assert.equal((await fetch(base+'/health/ready')).status,503);
    assert.equal((await fetch(base+'/v1/convert',{method:'POST',body,headers:headers(body,'fatal_request_00000000002')})).status,503);
    assert.equal((await fetch(base+'/health/live')).status,200);assert.equal(calls,1);
  });
  await serve({convert:async()=>{throw Error('must not run');}},async base=>{assert.equal((await fetch(base+'/health/ready')).status,503);});
});

test('actual HTTP response disconnect aborts conversion and capacity stays held until cleanup', {timeout:5000},async()=>{
  const body=heifFixture(),started=deferred(),aborted=deferred(),cleanup=deferred(),finished=deferred();let calls=0;
  await serve({isReady:()=>true,convert:async(_input,{signal})=>{
    calls++;started.resolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
    aborted.resolve();await cleanup.promise;finished.resolve();throw new ServiceError(499,'CONVERSION_CANCELLED','Cancelled');
  }},async base=>{
    const request=http.request(base+'/v1/convert',{method:'POST',headers:headers(body,'disconnect_request_000001')});
    request.on('error',()=>{});request.end(body);await started.promise;request.destroy();await aborted.promise;
    const busy=await fetch(base+'/v1/convert',{method:'POST',body,headers:headers(body,'disconnect_request_000002')});
    assert.equal(busy.status,429);assert.equal(busy.headers.get('retry-after'),'1');assert.equal(calls,1);
    cleanup.resolve();await finished.promise;
  });
});
