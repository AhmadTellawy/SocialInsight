import { randomUUID } from 'node:crypto';
import { must, sanitizedFailure, verifyBundle } from './core.mjs';
import { assertCredentialFree, profile, rejectInherited } from './contract.mjs';
import { runRelease } from './install.mjs';

try {
  const args=process.argv.slice(2), command=args.shift();
  must(['verify','preflight','deploy'].includes(command),'COMMAND_INVALID');
  if(command==='verify') {
    must(args.length===0,'ARGUMENT_INVALID'); rejectInherited(process.env); assertCredentialFree(process.env);
    const binding=verifyBundle();
    console.log(JSON.stringify({status:'PREPARED',migrations:18,application:binding.application,sourceBindingSha256:binding.bindingSha256,hostedReadiness:'REQUIRES_INDEPENDENT_CONFIG_AND_PRISMA_PROOF',applicationDeployment:false}));
  } else {
    const name=args.shift(); profile(name);
    const flags={};
    while(args.length) { const key=args.shift(); must(['--local','--transport','--run-id','--approval-file'].includes(key) && !Object.hasOwn(flags,key) && args.length>0,'ARGUMENT_INVALID'); flags[key]=args.shift(); }
    must(!flags['--local'] || (!flags['--approval-file'] && !flags['--transport']),'ARGUMENT_INVALID');
    const runId=flags['--run-id'] ?? (flags['--local']?randomUUID():undefined);
    const result=await runRelease({command,name,runId,localName:flags['--local'],transport:flags['--transport']??'direct',approvalFile:flags['--approval-file']});
    console.log(JSON.stringify(result)); if(result.status!=='PASSED') process.exitCode=1;
  }
} catch(error) { console.error(JSON.stringify({status:'REJECTED',failureCode:sanitizedFailure(error),applicationDeployment:false})); process.exitCode=1; }
