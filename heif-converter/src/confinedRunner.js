import { spawn } from 'node:child_process';
import { chmod, mkdtemp, open, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { ServiceError } from './errors.js';

const MAX_FRAME=12*1024*1024+1028;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function killGroup(pid) { try { process.kill(-pid,'SIGKILL'); } catch(e) { if(e.code!=='ESRCH') throw e; } }
async function gone(pid) {
  for(let i=0;i<100;i++) {
    try { process.kill(-pid,0); } catch(e) { if(e.code==='ESRCH')return; throw e; }
    await delay(20);
  }
  throw new ServiceError(503,'WORKER_CLEANUP_FAILED','Image processing is unavailable');
}
export async function runConfinedJob(input,{signal,probe=false,fault,timeoutMs=45_000,onSpawn=()=>{},onDiagnostic=()=>{},onLifetime=()=>{}}={}) {
  if(fault!==undefined&&!['orphan','hold','hang','stdout','stderr'].includes(fault))throw new TypeError('Invalid fixture');
  if (!Buffer.isBuffer(input) || input.length>15*1024*1024) throw new ServiceError(413,'IMAGE_TOO_LARGE','Image exceeds the limit');
  if(signal?.aborted) throw new ServiceError(499,'CONVERSION_CANCELLED','Image processing cancelled');
  const job=await mkdtemp('/tmp/heif-converter/job-');
  let child,cleanupFailure,canary;
  try {
    await chmod(job,0o700);
    await writeFile(job+'/input.heic',input,{flag:'wx',mode:0o600});
    await writeFile(job+'/decoded.png',Buffer.alloc(0),{flag:'wx',mode:0o600});
    // A real inherited descriptor outside Landlock's readable paths must close
    // before untrusted code starts; descriptor 63 is unused by the worker.
    if(probe)canary=await open('/etc/passwd','r');
    const result=await new Promise((resolve,reject)=>{
      const args=fault?['--fault-probe',job,fault,String(process.pid)]:[probe?'--probe':'--worker',job,String(process.pid)];
      const stdio=['ignore','pipe','pipe'];
      if(canary){while(stdio.length<63)stdio.push('ignore');stdio.push(canary.fd);}
      child=spawn('/usr/local/bin/si-heif-confine',args,{
        shell:false,detached:true,env:probe?{HEIF_CONVERTER_HMAC_SECRET:'synthetic-confinement-canary',NODE_OPTIONS:'--invalid-canary-option'}:{},stdio,
      });
      let bytes=0,parts=[],reason;
      const stop=code=>{reason??=code;if(child.pid)killGroup(child.pid);};
      const abort=()=>stop('CONVERSION_CANCELLED');
      const timer=setTimeout(()=>stop('CONVERSION_TIMEOUT'),Math.min(timeoutMs,45_000));
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted)abort();
      child.stdout.on('data',data=>{bytes+=data.length;if(bytes>MAX_FRAME)stop('INVALID_WORKER_OUTPUT');else parts.push(data);});
      let diagnosticBytes=0,diagnostics='';
      child.stderr.on('data',data=>{
        diagnosticBytes+=data.length;
        if(diagnosticBytes>2048)stop('INVALID_WORKER_OUTPUT');
        else {
          diagnostics+=data.toString('utf8');
          let index;
          while((index=diagnostics.indexOf('\n'))>=0) {
            const line=diagnostics.slice(0,index);diagnostics=diagnostics.slice(index+1);
            if(/^(CONFINEMENT_UNAVAILABLE:[A-Z_]+|CONFINEMENT_PROBE_FAILED:[A-Z_0-9]+)$/.test(line))onDiagnostic(line);
            if(/^(CONFINEMENT_PHASE:(NATIVE_STARTED|ENCODE_STARTED|ENCODE_FINISHED)|CONFINEMENT_NATIVE_EXIT:([0-9]{1,3}|SIG[A-Z]+|UNKNOWN))$/.test(line))onDiagnostic(line);
            if(line==='CONFINEMENT_NATIVE_TIMEOUT'){onDiagnostic(line);stop('CONVERSION_TIMEOUT');}
            if(fault&&/^CONFINEMENT_LIFETIME:[0-9]{1,10}$/.test(line))onLifetime(Number(line.split(':')[1]));
          }
        }
      });
      child.once('spawn',()=>onSpawn(child.pid));
      child.once('error',()=>{reason??='CONFINEMENT_UNAVAILABLE';});
      child.once('close',code=>{
        clearTimeout(timer);signal?.removeEventListener('abort',abort);
        if(reason || code!==0)reject(new ServiceError(reason==='CONVERSION_CANCELLED'?499:422,reason??'IMAGE_PROCESSING_FAILED','Image processing did not finish'));
        else resolve(Buffer.concat(parts));
      });
    });
    if(child.pid){killGroup(child.pid);await gone(child.pid);}
    if(((await stat('/tmp/heif-converter')).mode&0o777)!==0o700||((await stat(job)).mode&0o777)!==0o700)throw new ServiceError(503,'WORKER_CLEANUP_FAILED','Image processing is unavailable');
    const files=(await readdir(job)).sort();
    if(files.join(',')!=='decoded.png,input.heic' || (await stat(job+'/decoded.png')).size>128*1024*1024) throw new ServiceError(503,'INVALID_WORKER_OUTPUT','Image processing is unavailable');
    if(result.length<4)throw new ServiceError(503,'INVALID_WORKER_OUTPUT','Image processing is unavailable');
    const length=result.readUInt32BE(0);
    if(length<2 || length>1024 || result.length<length+4)throw new ServiceError(503,'INVALID_WORKER_OUTPUT','Image processing is unavailable');
    let header;
    try{header=JSON.parse(result.subarray(4,4+length).toString('utf8'));}catch{throw new ServiceError(503,'INVALID_WORKER_OUTPUT','Image processing is unavailable');}
    const data=result.subarray(4+length);
    if(probe) {
      if(header.ok!==true || header.bytes!==0 || data.length) throw new ServiceError(503,'CONFINEMENT_UNAVAILABLE','Image processing is unavailable');
      return header;
    }
    if(header.ok!==true || header.mime!=='image/webp' || header.bytes!==data.length || !data.length
      || data.length>12*1024*1024 || !Number.isInteger(header.width) || !Number.isInteger(header.height)
      || header.width<1 || header.height<1 || header.width>2400 || header.height>2400)
      throw new ServiceError(503,'INVALID_WORKER_OUTPUT','Image processing is unavailable');
    return Object.freeze({data,mime:header.mime,width:header.width,height:header.height});
  } finally {
    await canary?.close();
    if(child?.pid) { try { killGroup(child.pid);await gone(child.pid); } catch(e) { cleanupFailure=e; } }
    if(!cleanupFailure)await rm(job,{recursive:true,force:false});
    if(cleanupFailure)throw cleanupFailure;
  }
}
