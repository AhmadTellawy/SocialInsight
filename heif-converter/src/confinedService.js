import fs from 'node:fs/promises';
import { runConfinedJob } from './confinedRunner.js';
import { verifyBootstrap, verifyTempRoot, verifyResourceCounters } from './confinementBootstrap.js';
import { runStartupProcessControl, validateProcessControl } from './processControl.js';
import { ServiceError } from './errors.js';

const unavailable=()=>new ServiceError(503,'CONVERTER_UNAVAILABLE','Image processing is unavailable');
export class ConfinedHeifConverter {
  #state='starting';
  #active=false;
  #shutdown=new AbortController();
  #idle=Promise.resolve();
  #fatalNotified=false;
  constructor({runJob=runConfinedJob,bootstrap=verifyBootstrap,checkRoot=verifyTempRoot,io=fs,onDiagnostic=()=>{},onFatal=()=>{},processProof=runStartupProcessControl,checkCounters=verifyResourceCounters}={}) {
    this.runJob=runJob;this.bootstrap=bootstrap;this.checkRoot=checkRoot;this.io=io;this.onDiagnostic=onDiagnostic;
    this.onFatal=onFatal;this.processProof=processProof;this.checkCounters=checkCounters;
  }
  setFatalHandler(handler){this.onFatal=handler;}
  isReady(){return this.#state==='ready';}
  markUnhealthy(){
    this.#state='unhealthy';this.#shutdown.abort();
    if(!this.#fatalNotified){this.#fatalNotified=true;this.onFatal();}
  }
  stop(){this.#state='unhealthy';this.#shutdown.abort();return this.#idle;}
  async initialize() {
    if(this.#state!=='starting')throw unavailable();
    try {
      this.envelope=await this.bootstrap();
      this.processControl=validateProcessControl(await this.processProof(this.envelope.resources,{signal:this.#shutdown.signal}));
      this.probe=await this.runJob(Buffer.alloc(0),{probe:true,signal:this.#shutdown.signal});
      if(this.probe.ok!==true||this.probe.checks.length!==19||this.probe.syscallReport.negativeSyscalls!==31)throw unavailable();
      await this.checkRoot();
      if(this.#state!=='starting'||this.#shutdown.signal.aborted)throw unavailable();
      this.#state='ready';return {probe:this.probe,envelope:this.envelope,processControl:this.processControl};
    } catch(error) {
      this.markUnhealthy();
      const phases=['IDENTITY','CAPABILITIES','PROCESS_LIMIT','SUPERVISOR','STORAGE','RESOURCES','CGROUP_LAYOUT','MEMORY_LIMIT','SWAP_LIMIT','PIDS_LIMIT','CPU_LIMIT'];
      this.onDiagnostic(phases.includes(error?.phase)?`STARTUP_${error.phase}`:'STARTUP_PROBE');
      throw unavailable();
    }
  }
  async convert(input,{signal}={}) {
    if(!this.isReady())throw unavailable();
    if(this.#active)throw new ServiceError(429,'CONVERTER_BUSY','Image conversion is busy');
    this.#active=true;
    let completed;
    this.#idle=new Promise(resolve=>{completed=resolve;});
    try {
      await this.checkRoot();
      return await this.runJob(input,{onDiagnostic:this.onDiagnostic,signal:signal?AbortSignal.any([signal,this.#shutdown.signal]):this.#shutdown.signal});
    } catch(error) {
      if(!(error instanceof ServiceError)||error.status>=500||error.code==='CONFINEMENT_UNAVAILABLE')this.markUnhealthy();
      throw error instanceof ServiceError?error:unavailable();
    } finally {
      try {
        await this.checkRoot();
        await this.checkCounters(this.envelope.resources,this.io);
      } catch {this.markUnhealthy();}
      this.#active=false;
      completed();
      if(!this.isReady())throw unavailable();
    }
  }
}
