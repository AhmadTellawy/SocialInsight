// Credential-free image test only; never imported by the HTTP broker.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { TEMP_ROOT, verifyTempRoot } from './confinementBootstrap.js';

export async function runEntrypointMatrix() {
  const parent=String(process.pid), launcher='/usr/local/bin/si-heif-confine';
  const legacy=[['--native','input','decoded',parent],['--syscall-probe',parent],
    ['--fork-exhaust-probe',parent],['--thread-exhaust-probe',parent],['--group-probe',parent],
    ['--fork-sleeper','hold',parent],['--parent-race-probe'],['--healthcheck','http://invalid']];
  const execute=async(args,timeout=10000)=>{
    let child,output='',diagnostic='',expired=false;
    try {
      return await new Promise((resolve,reject)=>{
        child=spawn(launcher,args,{env:{},detached:true,stdio:['ignore','pipe','pipe']});
        const timer=setTimeout(()=>{expired=true;process.kill(-child.pid,'SIGKILL');},timeout);
        child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>16384)process.kill(-child.pid,'SIGKILL');});
        child.stderr.on('data',chunk=>{diagnostic+=chunk.toString();if(diagnostic.length>4096)process.kill(-child.pid,'SIGKILL');});
        child.once('error',reject);
        child.once('close',code=>{clearTimeout(timer);resolve({code,output,diagnostic,expired});});
      });
    } finally {
      if(child?.pid) {
        try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
        let gone=false;
        for(let i=0;i<100;i++) {
          try{process.kill(-child.pid,0);}catch(error){if(error.code==='ESRCH'){gone=true;break;}throw error;}
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        assert.equal(gone,true,'entrypoint cleanup');
      }
    }
  };
  for(const args of legacy){const r=await execute(args);assert.equal(r.code,78);assert.equal(r.output,'');assert.ok(!r.diagnostic.includes('CONFINEMENT_GATEWAY:'));}
  let accepted=0;
  const modes=['worker','probe','native','native-version','syscall-probe','group-probe','fault-probe','fault-helper','worker-process-probe'];
  for(const mode of modes) {
    const job=await fs.mkdtemp(`${TEMP_ROOT}/job-`);
    try {
      await fs.chmod(job,0o700);
      await fs.writeFile(`${job}/input.heic`,Buffer.alloc(0),{flag:'wx',mode:0o600});
      await fs.writeFile(`${job}/decoded.png`,Buffer.alloc(0),{flag:'wx',mode:0o600});
      const suffix=mode==='native'?[`${job}/input.heic`,`${job}/decoded.png`]
        :mode==='fault-probe'?['hang']:mode==='fault-helper'?['hold']:mode==='worker-process-probe'?['forks']:[];
      const r=await execute([`--${mode}`,job,...suffix,parent],mode.startsWith('fault')?1500:10000);
      assert.ok(r.diagnostic.includes('CONFINEMENT_GATEWAY:32_LANDLOCK_SECCOMP\n'),mode);
      assert.notEqual(r.code,78,mode);
      if(!mode.startsWith('fault'))assert.equal(r.expired,false,mode);
      accepted++;
    } finally {await fs.rm(job,{recursive:true,force:false});}
    await verifyTempRoot();
  }
  return {legacyRejected:legacy.length,gatewayModes:accepted};
}
