import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { checkHealth } from '../src/fixedHealthcheck.js';

const response = (statusCode, body) => (_options, callback) => {
  const req=new EventEmitter();
  req.destroy=error=>{req.emit('error',error);req.emit('close');};
  req.end=()=>queueMicrotask(()=>{
    const res=new EventEmitter();res.statusCode=statusCode;res.destroy=()=>{};
    callback(res);
    if(statusCode===200){res.emit('data',Buffer.from(body));res.emit('end');req.emit('close');}
  });
  return req;
};
test('fixed health module requires status/schema/policy and a bounded complete response',async()=>{
  const good={status:'ready',confinement:{status:'passed',schemaVersion:2,policy:'rlimit-nproc-v2'}};
  await checkHealth({},response(200,JSON.stringify(good)));
  for(const body of [{...good,status:'unavailable'}, {...good,confinement:{...good.confinement,schemaVersion:1}},
    {...good,confinement:{...good.confinement,policy:'legacy'}},{status:'ready'}])await assert.rejects(checkHealth({},response(200,JSON.stringify(body))));
  await assert.rejects(checkHealth({},response(503,JSON.stringify(good))));
  await assert.rejects(checkHealth({},response(200,'invalid JSON')));
  await assert.rejects(checkHealth({},response(200,' '.repeat(16385))));
});
