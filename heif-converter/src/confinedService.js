import fs from 'node:fs/promises';
import { runConfinedJob } from './confinedRunner.js';
import { verifyBootstrap, verifyTempRoot } from './bootstrap.js';
import { ServiceError } from './errors.js';

const unavailable=()=>new ServiceError(503,'CONVERTER_UNAVAILABLE','Image processing is unavailable');
export class ConfinedHeifConverter {
  #state='starting';
  #active=false;
  constructor({runJob=runConfinedJob,bootstrap=verifyBootstrap,checkRoot=verifyTempRoot,io=fs}={}) {
    this.runJob=runJob;this.bootstrap=bootstrap;this.checkRoot=checkRoot;this.io=io;
  }
  isReady(){return this.#state==='ready';}
  markUnhealthy(){this.#state='unhealthy';}
  async initialize() {
    if(this.#state!=='starting')throw unavailable();
    try {
      this.envelope=await this.bootstrap();
      this.probe=await this.runJob(Buffer.alloc(0),{probe:true});
      if(this.probe.ok!==true||this.probe.checks.length!==19||this.probe.syscallReport.negativeSyscalls!==31)throw unavailable();
      await this.checkRoot();
      this.#state='ready';return {probe:this.probe,envelope:this.envelope};
    } catch {this.markUnhealthy();throw unavailable();}
  }
  async convert(input,{signal}={}) {
    if(!this.isReady())throw unavailable();
    if(this.#active)throw new ServiceError(429,'CONVERTER_BUSY','Image conversion is busy');
    this.#active=true;
    try {
      await this.checkRoot();
      return await this.runJob(input,{signal});
    } catch(error) {
      if(!(error instanceof ServiceError)||error.status>=500||error.code==='CONFINEMENT_UNAVAILABLE')this.markUnhealthy();
      throw error instanceof ServiceError?error:unavailable();
    } finally {
      try {
        await this.checkRoot();
        const events=Object.fromEntries((await this.io.readFile(this.envelope.resources.memoryEventsPath,'utf8')).trim().split('\n').map(line=>line.split(/\s+/)));
        if(Number(events.oom)!==this.envelope.resources.oom||Number(events.oom_kill)!==this.envelope.resources.oomKill)throw unavailable();
      } catch {this.markUnhealthy();}
      this.#active=false;
      if(!this.isReady())throw unavailable();
    }
  }
}
