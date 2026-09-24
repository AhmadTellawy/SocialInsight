import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { parsePort } from '../src/port.js';
import { loadConfig } from '../src/config.js';
import { checkHealth } from '../src/fixedHealthcheck.js';

const values=[undefined,'1','8080','10000','65535','0','65536','010000','10000x',' 10000','10000 ',
  '10000\n','10000\r\n','+10000','-1','1.0','1e4','','00001','999999','１２３'];
const valid=value=>value===undefined||['1','8080','10000','65535'].includes(value);
const secret='synthetic-test-only-secret-32-bytes';
test('shared server and health port table rejects before any network attempt',async()=>{
  for(const value of values) {
    const env={HEIF_CONVERTER_HMAC_SECRET:secret,...(value===undefined?{}:{PORT:value})};
    let calls=0;
    const request=options=>{
      calls++;assert.equal(options.hostname,'127.0.0.1');assert.equal(options.path,'/health/ready');
      assert.equal(options.port,value===undefined?8080:Number(value));
      const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{req.emit('error',Error('synthetic network failure'));req.emit('close');});
      req.destroy=()=>{};return req;
    };
    if(valid(value)) {
      assert.equal(loadConfig(env).port,parsePort(value));
      await assert.rejects(checkHealth(env,request),/synthetic/);assert.equal(calls,1);
    } else {
      assert.throws(()=>parsePort(value));assert.throws(()=>loadConfig(env));
      assert.throws(()=>checkHealth(env,request));assert.equal(calls,0);
    }
  }
  assert.equal(loadConfig({HEIF_CONVERTER_HMAC_SECRET:secret}).host,'0.0.0.0');
  for(const HOST of ['0.0.0.0','127.0.0.1','']) {
    assert.throws(()=>loadConfig({HEIF_CONVERTER_HMAC_SECRET:secret,HOST}));
    assert.throws(()=>checkHealth({HOST},()=>{throw Error('must not connect');}));
  }
});
test('native health parser and shared JS parser have identical table acceptance and output',
  {skip:!process.env.SI_NATIVE_PORT_TEST_BINARY},()=>{
    for(const value of values) {
      const env={...(value===undefined?{}:{PORT:value})};
      const result=spawnSync(process.env.SI_NATIVE_PORT_TEST_BINARY,[],{env,encoding:'utf8',timeout:2000});
      assert.equal(result.error,undefined);
      assert.equal(result.status,valid(value)?0:78,JSON.stringify(value));
      if(valid(value))assert.equal(result.stdout.trim(),String(parsePort(value)));
    }
  });
