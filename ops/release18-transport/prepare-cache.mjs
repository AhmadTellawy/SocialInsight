// Separate credential-free cache preparation/roundtrip; never called by capture after credentials.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { SERVICE,FROZEN_BINDING,must,failureCode,frozenPackage,environmentGuard,cleanEnvironment,sourceSnapshot,digest,sha256,readRegular } from './contract.mjs';
import { saveCache,materializeCache } from './cache.mjs';
import { gitRevision } from './capture.mjs';
import { publishCache } from './public-result.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url)),PACKAGE=path.resolve(HERE,'../../server/scripts/release-db-18');
export async function prepareCache({argv=process.argv.slice(2),env=process.env,platform=process.platform,runnerRoot=HERE,packageRoot=PACKAGE}={},deps={}) {
  try {
    must(platform==='linux','HOSTED_LINUX_REQUIRED');
    for(const key of Object.keys(env)) {
      if(['BASH_FUNC_copy_secret_files%%','BASH_FUNC_remove_secret_files%%'].includes(key))continue;
      must(!/(PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|PRIVATE_KEY|ACCESS_KEY|API_KEY|DATABASE_URL|DIRECT_URL|^PG)/i.test(key),'CACHE_PREPARATION_MUST_BE_CREDENTIAL_FREE');
    }
    // Existing non-secret legacy verify selector is checked, never forwarded.
    const namesOnly={};
    for(const key of Object.keys(env)) {
      if(key==='STAGING_INITIAL_INSTALL_MODE'){must(env[key]==='verify','LEGACY_MODE_INVALID');continue;}
      Object.defineProperty(namesOnly,key,{enumerable:true,get(){throw new Error('VALUE_ACCESS_FORBIDDEN');}});
    }
    environmentGuard(namesOnly);
    must(argv.length===1&&argv[0]==='prepare-cache'||argv.length===3&&argv[0]==='verify-cache'&&argv[1]==='--manifest-sha256','ARGUMENT_INVALID');
    if(argv[0]==='verify-cache')digest(argv[2]);
    const verify=deps.frozenPackage??frozenPackage;verify(packageRoot);
    const clean=cleanEnvironment(env),repository=path.resolve(packageRoot,'../../..');
    const opsRevision=(deps.gitRevision??gitRevision)(repository,clean);
    must(env.RENDER_SERVICE_ID===SERVICE&&env.RENDER_GIT_COMMIT===opsRevision,'PROVIDER_IDENTITY_INVALID');
    const cacheHome=env.XDG_CACHE_HOME;
    const source=sourceSnapshot(runnerRoot),runId=randomUUID();
    let result;
    if(argv[0]==='prepare-cache') {
      // Same credential-free DB18 protocol; frozen imports only, without legacy helper imports.
      const invoke=(program,args,timeout)=>{
        const result=(deps.spawnSync??spawnSync)(program,args,{cwd:packageRoot,env:clean,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout,maxBuffer:2097152,windowsHide:true});
        must(result&&result.status===0&&!result.error&&!result.signal,'CREDENTIAL_FREE_PACKAGE_VERIFY_FAILED');
      };
      invoke('npm',['ci'],300000);
      verify(packageRoot);
      invoke(process.execPath,[path.join(packageRoot,'launch.mjs'),'verify'],60000);
      invoke(process.execPath,[path.join(packageRoot,'tests/tls.mjs')],210000);
      verify(packageRoot);
      const verifyRuntime=deps.verifyRuntime??(await import(pathToFileURL(path.join(packageRoot,'install.mjs')))).verifyRuntime;
      verifyRuntime(packageRoot,false);
      result=(deps.saveCache??saveCache)({cacheHome,packageRoot,runnerRoot,opsRevision,platform});
    } else {
      const base='/tmp/opiniup-release18-cache-check';
      if(!fs.existsSync(base))fs.mkdirSync(base,{mode:0o700});
      const {directory}=await import('./contract.mjs');directory(base);
      must((fs.statSync(base).mode&0o077)===0 && fs.statSync(base).uid===process.getuid(),'PRIVATE_DIRECTORY_PERMISSIONS_INVALID');
      const runDirectory=path.join(base,runId);fs.mkdirSync(runDirectory,{mode:0o700});
      const copy=materializeCache({cacheHome,manifestSha256:argv[2],packageRoot,runnerRoot,runDirectory,platform});
      const {verifyRuntime}=await import(pathToFileURL(path.join(packageRoot,'install.mjs')));
      verifyRuntime(copy.runtimeRoot,false);
      const manifest=JSON.parse(fs.readFileSync(path.join(cacheHome,'opiniup-db18-toolchain',argv[2],'manifest.json'),'utf8'));
      result={manifestSha256:argv[2],files:manifest.files.length,bytes:manifest.files.reduce((n,f)=>n+f.bytes,0)};
    }
    must(sourceSnapshot(runnerRoot)===source,'RUNNER_SOURCE_CHANGED');
    const summary={event:'RELEASE18_TOOLCHAIN_CACHE',status:'PASSED',phase:argv[0]==='prepare-cache'?'CACHE_PREPARED':'CACHE_ROUNDTRIP',runId,serviceId:SERVICE,opsRevision,sourceBindingSha256:FROZEN_BINDING,runnerSourceSha256:source,cacheManifestSha256:result.manifestSha256,files:result.files,bytes:result.bytes,databaseMutation:false,applicationDeployment:false};
    (deps.publish??publishCache)(summary,runnerRoot);
    (deps.emit??(v=>console.log(JSON.stringify(v))))(summary);
    return summary;
  } catch(error) {
    const result={event:'RELEASE18_TOOLCHAIN_CACHE',status:'REJECTED',failureCode:failureCode(error),databaseMutation:false,applicationDeployment:false};
    try{(deps.emit??(v=>console.log(JSON.stringify(v))))(result);}catch{}
    return result;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const r=await prepareCache();if(r.status!=='PASSED')process.exitCode=1;}
