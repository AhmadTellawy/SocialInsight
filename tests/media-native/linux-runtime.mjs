// Public, credential-free synthetic capacity test. Only the localhost test
// container receives this fixed fixture key. No provider/project secrets load.
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire('/app/package.json');
const sharp = require('sharp');
if (process.argv[2] === 'generate') {
  for (const [name,width,height] of [['12mp',4000,3000],['40mp',8000,5000]]) {
    // Deterministic synthetic pixels, genuine encoded dimensions. These do not
    // claim camera/HDR/noisy worst-case compression coverage.
    const pixels = Buffer.alloc(width*height*3);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const i=(y*width+x)*3; pixels[i]=(x>>4)%256; pixels[i+1]=(y>>4)%256; pixels[i+2]=((x+y)>>5)%256;
    }
    await sharp(pixels,{raw:{width,height,channels:3}}).png().toFile(`/fixtures/generated/${name}.png`);
  }
  process.exit(0);
}
assert.equal(process.argv[2], 'test');
const base='http://127.0.0.1:18080';
const secret='synthetic-ci-fixture-key-not-an-application-secret';
const reports=[];
let health;
for(let attempt=0;attempt<30;attempt++) {
  try { const r=await fetch(base+'/health/ready',{signal:AbortSignal.timeout(3000)}); if(r.ok){health=await r.json();break;} } catch {}
  await new Promise(resolve=>setTimeout(resolve,1000));
}
assert.ok(health,'Pinned native runtime must become ready');
assert.equal(health.protocolVersion,2);
assert.deepEqual(health.capabilities,{wholeWorkerIsolation:'landlock-seccomp-v1',supervisor:'subreaper-v1',failurePolicy:'fail-closed-v1'});
assert.deepEqual(health.limits,{inputBytes:15728640,outputBytes:12582912,maxPixels:40000000,wholeWorkerMs:45000});
console.log(JSON.stringify({kind:'READY',health}));
function headers(body, id=randomUUID()) {
  const timestamp=String(Math.floor(Date.now()/1000)); const digest=createHash('sha256').update(body).digest('hex');
  return {'content-type':'application/octet-stream','x-si-timestamp':timestamp,'x-si-request-id':id,'x-si-body-sha256':digest,
    'x-si-signature':'v1='+createHmac('sha256',secret).update(`v1\n${timestamp}\n${id}\n${digest}`).digest('hex')};
}
let failures=0;
async function convert(name,body,expected) {
  const started=performance.now(); const report={name,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')};
  try {
    const response=await fetch(base+'/v1/convert',{method:'POST',body,headers:headers(body),signal:AbortSignal.timeout(60000)});
    report.status=response.status;
    if(response.ok) {
      const output=Buffer.from(await response.arrayBuffer()); const metadata=await sharp(output).metadata();
      report.output={bytes:output.length,width:metadata.width,height:metadata.height,format:metadata.format};
      assert.equal(metadata.format,'webp'); assert.ok(metadata.width<=2400 && metadata.height<=2400);
      for(const field of ['exif','xmp','iptc','icc','orientation']) assert.equal(metadata[field],undefined);
      assert.equal(expected,'SUCCESS');
    } else {
      report.error=(await response.json()).error?.code;
      assert.equal(expected,'REJECT'); assert.ok(response.status>=400 && response.status<500);
    }
    report.result='PASSED';
  } catch(error) { failures++;report.result='FAILED';report.failure=error.code||error.name; }
  report.elapsedMs=Math.round(performance.now()-started); reports.push(report); console.log(JSON.stringify(report));
}
const camera=Buffer.from(await readFile('/fixtures/fixtures/camera-sample.base64','utf8'),'base64');
await convert('camera',camera,'SUCCESS');
await convert('camera-repeat',camera,'SUCCESS');
await convert('camera-repeat-2',camera,'SUCCESS');
await convert('clean-aperture',await readFile('/fixtures/fixtures/rainbow-451x461.heic'),'SUCCESS');
await convert('alpha',await readFile('/fixtures/fixtures/with-alpha-512x512.heic'),'SUCCESS');
await convert('generated-12mp',await readFile('/fixtures/generated/12mp.heic'),'SUCCESS');
await convert('generated-40mp',await readFile('/fixtures/generated/40mp.heic'),'SUCCESS');
const padding=Buffer.alloc(15*1024*1024-camera.length); padding.writeUInt32BE(padding.length);padding.write('free',4,'ascii');
await convert('near15MiB-valid-free-box',Buffer.concat([camera,padding]),'SUCCESS');
await convert('sequence',await readFile('/fixtures/fixtures/example.heic'),'REJECT');
await convert('uncompressed-codec',await readFile('/fixtures/fixtures/uncompressed_pix_RGB.heif'),'REJECT');
await convert('truncated',camera.subarray(0,48),'REJECT');
const proof=headers(camera);
const first=await fetch(base+'/v1/convert',{method:'POST',body:camera,headers:proof,signal:AbortSignal.timeout(60000)});await first.arrayBuffer();
const replay=await fetch(base+'/v1/convert',{method:'POST',body:camera,headers:proof,signal:AbortSignal.timeout(5000)});
assert.equal(replay.status,409);await replay.arrayBuffer();
const cancellation=new AbortController();
const longInput=await readFile('/fixtures/generated/40mp.heic');
const pending=fetch(base+'/v1/convert',{method:'POST',body:longInput,headers:headers(longInput),signal:cancellation.signal}).then(()=>{throw Error('Expected cancellation');},error=>{assert.equal(error.name,'AbortError');});
await new Promise(resolve=>setTimeout(resolve,500));
const busy=await fetch(base+'/v1/convert',{method:'POST',body:camera,headers:headers(camera),signal:AbortSignal.timeout(5000)});
assert.equal(busy.status,429);assert.equal(busy.headers.get('retry-after'),'1');await busy.arrayBuffer();
cancellation.abort();await pending;
let resumed=false;
for(let attempt=0;attempt<20;attempt++) {
  const retry=await fetch(base+'/v1/convert',{method:'POST',body:camera,headers:headers(camera),signal:AbortSignal.timeout(60000)});
  await retry.arrayBuffer();if(retry.status===200){resumed=true;break;}
  assert.equal(retry.status,429);await new Promise(resolve=>setTimeout(resolve,250));
}
assert.equal(resumed,true);assert.equal((await fetch(base+'/health/ready')).status,200);
console.log(JSON.stringify({kind:'HTTP_CANCELLATION',busyRejected:true,callerAborted:true,laterConversionSucceeded:true}));
console.log(JSON.stringify({kind:'SUMMARY',resourceLimits:{memoryBytes:536870912,cpu:0.1},cases:reports.length,failures,replayRejected:true,productionRuntimeVerified:false}));
if(failures)process.exitCode=1;
