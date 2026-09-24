import { spawn } from 'node:child_process';
import { stat, readdir } from 'node:fs/promises';
import sharp from 'sharp';
import { inspectConfinedOutput } from './confinedOutputEvidence.js';

sharp.block({operation:['VipsForeignLoad']});
sharp.unblock({operation:['VipsForeignLoadPngFile','VipsForeignLoadWebpBuffer']});
sharp.cache(false);
sharp.concurrency(1);
const [input, decoded] = process.argv.slice(2);
function frame(header, data = Buffer.alloc(0)) {
  const json=Buffer.from(JSON.stringify(header));
  const prefix=Buffer.alloc(4); prefix.writeUInt32BE(json.length);
  process.stdout.write(prefix); process.stdout.write(json); process.stdout.end(data);
}
try {
  await new Promise((resolve,reject)=>{
    // Never detached: the launcher sealed the worker group before Node started.
    let child;
    try {
      child=spawn('/usr/local/bin/si-heif-confine',['--native',process.cwd(),input,decoded,String(process.pid)],{
        env:{}, shell:false, detached:false, stdio:'ignore',
      });
    } catch { reject(new Error('NATIVE_START_FAILED')); return; }
    process.stderr.write('CONFINEMENT_PHASE:NATIVE_STARTED\n');
    // The broker still enforces 45 seconds for this complete fresh worker.
    // Reserve the remainder for Sharp after bounded native decoding on 0.1CPU.
    const timer=setTimeout(()=>{process.stderr.write('CONFINEMENT_NATIVE_TIMEOUT\n');process.kill(0,'SIGKILL');},30_000);
    child.once('error',()=>{clearTimeout(timer);reject(new Error('NATIVE_START_FAILED'));});
    child.once('close',(code,signal)=>{clearTimeout(timer);process.stderr.write('CONFINEMENT_NATIVE_EXIT:'+String(code??signal??'UNKNOWN')+'\n');code===0?resolve():reject(new Error(code===78?'NATIVE_CONFINEMENT_FAILED':'INVALID_HEIF'));});
  });
  const files=(await readdir(process.cwd())).sort();
  const output=await stat(decoded);
  if (files.join(',')!=='decoded.png,input.heic' || !output.isFile() || output.size<1 || output.size>128*1024*1024) throw new Error('INVALID_HEIF');
  // File streaming avoids an extra full decoded-PNG buffer for large images.
  process.stderr.write('CONFINEMENT_PHASE:ENCODE_STARTED\n');
  const {data,info}=await sharp(decoded,{failOn:'error',limitInputPixels:40_000_000,sequentialRead:true})
    .rotate().toColourspace('srgb')
    .resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true})
    .webp({quality:92,alphaQuality:100,smartSubsample:true,effort:4})
    .toBuffer({resolveWithObject:true});
  if(info.format!=='webp')throw new Error('INVALID_ENCODED_OUTPUT');
  const evidence=await inspectConfinedOutput(data,sharp);
  process.stderr.write('CONFINEMENT_PHASE:ENCODE_FINISHED\n');
  frame({ok:true,mime:'image/webp',...evidence,bytes:data.length},data);
 } catch (error) {
  // Report only a fixed classification, never a native message or file path.
  const reason=error?.code==='EAGAIN'||/thread|Resource temporarily unavailable/i.test(String(error?.message))?'THREAD_RESOURCE':error?.message==='NATIVE_START_FAILED'?'NATIVE_START':error?.message==='NATIVE_CONFINEMENT_FAILED'?'NATIVE_CONFINEMENT':error?.message==='INVALID_HEIF'?'NATIVE_REJECT':'ENCODE_REJECT';
  const fatal=['NATIVE_START','NATIVE_CONFINEMENT','THREAD_RESOURCE'].includes(reason);
  process.stderr.write('CONFINEMENT_FAILURE:'+reason+'\n');
  frame({ok:false,code:fatal?'CONFINEMENT_UNAVAILABLE':'IMAGE_PROCESSING_FAILED',bytes:0});
  process.exitCode=fatal?78:1;
}
