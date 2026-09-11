import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FROZEN_BINDING,CLI_SHA256,ENGINE_SHA256,CA_SHA256,must,digest,readRegular,directory,sha256,canonical,exact,sourceSnapshot } from './contract.mjs';

const MAX_FILES=15000,MAX_BYTES=536870912;
function safeRelative(name) { must(typeof name==='string' && name.length<512 && !path.isAbsolute(name)&&!name.includes('\\')&&name.split('/').every(p=>p && p!=='.'&&p!=='..')&&!/[\u0000\r\n]/.test(name),'CACHE_PATH_INVALID'); }
export function dependencyFiles(root,{excludeBin=false,privateTree=false,platform=process.platform}={}) {
  directory(root);let total=0;const list=[];
  function scan(dir,prefix='') {
    directory(dir);
    if(privateTree && platform==='linux')must((fs.statSync(dir).mode&0o077)===0&&fs.statSync(dir).uid===process.getuid(),'CACHE_PERMISSIONS_INVALID');
    for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if(excludeBin && entry.name==='.bin')continue; // Absolute CLI/engine invocation needs no npm bin links.
      must(!entry.isSymbolicLink(),'CACHE_SYMLINK_FORBIDDEN');
      must(!/^\.env(?:\.|$)|^\.npmrc$|^evidence$/i.test(entry.name),'CACHE_PRIVATE_INPUT_FORBIDDEN');
      const relative=prefix?prefix+'/'+entry.name:entry.name;safeRelative(relative);
      const full=path.join(dir,entry.name);
      if(entry.isDirectory())scan(full,relative);
      else {
        must(entry.isFile(),'CACHE_FILE_INVALID');
        const stat=fs.lstatSync(full);
        if(platform==='linux')must(stat.uid===process.getuid() && (stat.mode&0o022)===0 && (!privateTree || (stat.mode&0o077)===0),'CACHE_PERMISSIONS_INVALID');
        const bytes=readRegular(full,67108864);total+=bytes.length;
        must(total<=MAX_BYTES&&list.length<MAX_FILES,'CACHE_SIZE_INVALID');
        list.push({path:relative,bytes:bytes.length,sha256:sha256(bytes),executable:(fs.statSync(full).mode&0o111)!==0});
      }
    }
  }
  scan(root);return list.sort((a,b)=>a.path.localeCompare(b.path));
}
export function cacheBase(cacheHome,platform=process.platform) {
  must(typeof cacheHome==='string'&&path.isAbsolute(cacheHome),'CACHE_HOME_REQUIRED');
  directory(cacheHome);
  if(platform==='linux')must(fs.statSync(cacheHome).uid===process.getuid()&&(fs.statSync(cacheHome).mode&0o022)===0,'CACHE_HOME_PERMISSIONS_INVALID');
  const base=path.join(cacheHome,'opiniup-db18-toolchain');
  if(!fs.existsSync(base))fs.mkdirSync(base,{mode:0o700});
  directory(base);
  if(platform==='linux')must((fs.statSync(base).mode&0o077)===0&&fs.statSync(base).uid===process.getuid(),'CACHE_PERMISSIONS_INVALID');
  return base;
}
function copyFiles(from,to,files) {
  fs.mkdirSync(to,{mode:0o700});
  for(const f of files) {
    safeRelative(f.path);
    const source=readRegular(path.join(from,f.path),67108864);must(source.length===f.bytes&&sha256(source)===f.sha256,'CACHE_SOURCE_CHANGED');
    const dest=path.join(to,f.path);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});
    directory(path.dirname(dest));
    fs.writeFileSync(dest,source,{flag:'wx',mode:f.executable?0o700:0o600});
  }
}
export function cacheManifest({packageRoot,runnerRoot,nodeVersion=process.version,opsRevision,files}) {
  return {schemaVersion:1,kind:'CREDENTIAL_FREE_DB18_PUBLIC_TOOLCHAIN',sourceBindingSha256:FROZEN_BINDING,runnerSourceSha256:sourceSnapshot(runnerRoot),packageLockSha256:sha256(readRegular(path.join(packageRoot,'package-lock.json'))),nodePlatform:'linux',nodeVersion,prismaVersion:'6.19.2',cliSha256:CLI_SHA256,engineSha256:ENGINE_SHA256,caSha256:CA_SHA256,preparedOperationsCommit:opsRevision,excluded:'NPM_BIN_LINKS_ONLY',files};
}
export function validateManifest(m,{packageRoot,runnerRoot,nodeVersion=process.version}) {
  exact(m,['schemaVersion','kind','sourceBindingSha256','runnerSourceSha256','packageLockSha256','nodePlatform','nodeVersion','prismaVersion','cliSha256','engineSha256','caSha256','preparedOperationsCommit','excluded','files'],'CACHE_MANIFEST_INVALID');
  must(m.schemaVersion===1&&m.kind==='CREDENTIAL_FREE_DB18_PUBLIC_TOOLCHAIN'&&m.sourceBindingSha256===FROZEN_BINDING&&m.runnerSourceSha256===sourceSnapshot(runnerRoot)&&m.packageLockSha256===sha256(readRegular(path.join(packageRoot,'package-lock.json'))),'CACHE_MANIFEST_BINDING_INVALID');
  must(m.nodePlatform==='linux'&&m.nodeVersion===nodeVersion&&m.prismaVersion==='6.19.2'&&m.cliSha256===CLI_SHA256&&m.engineSha256===ENGINE_SHA256&&m.caSha256===CA_SHA256&&m.excluded==='NPM_BIN_LINKS_ONLY','CACHE_RUNTIME_MISMATCH');
  must(typeof m.preparedOperationsCommit==='string'&&/^[a-f0-9]{40}$/.test(m.preparedOperationsCommit),'CACHE_REVISION_INVALID');
  must(Array.isArray(m.files)&&m.files.length>0&&m.files.length<=MAX_FILES,'CACHE_MANIFEST_INVALID');
  let total=0;const seen=new Set();
  for(const f of m.files){exact(f,['path','bytes','sha256','executable'],'CACHE_MANIFEST_INVALID');safeRelative(f.path);digest(f.sha256);must(Number.isSafeInteger(f.bytes)&&f.bytes>=0&&f.bytes<=67108864&&typeof f.executable==='boolean'&&!seen.has(f.path),'CACHE_MANIFEST_INVALID');seen.add(f.path);total+=f.bytes;}
  must(total<=MAX_BYTES,'CACHE_SIZE_INVALID');
  must(canonical([...m.files].sort((a,b)=>a.path.localeCompare(b.path)))===canonical(m.files),'CACHE_ORDER_INVALID');
  return m;
}
export function saveCache({cacheHome,packageRoot,runnerRoot,opsRevision,nodeVersion=process.version,platform=process.platform}) {
  const base=cacheBase(cacheHome,platform),source=path.join(packageRoot,'node_modules');
  const files=dependencyFiles(source,{excludeBin:true,platform});
  const manifest=cacheManifest({packageRoot,runnerRoot,nodeVersion,opsRevision,files}),bytes=canonical(manifest),manifestSha256=sha256(bytes);
  const final=path.join(base,manifestSha256);
  if(fs.existsSync(final)){verifyCache({cacheHome,manifestSha256,packageRoot,runnerRoot,nodeVersion,platform});return {manifestSha256,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),reusedVerifiedCache:true};}
  const pending=path.join(base,'preparing-'+randomUUID());fs.mkdirSync(pending,{mode:0o700});
  copyFiles(source,path.join(pending,'node_modules'),files);
  fs.writeFileSync(path.join(pending,'manifest.json'),bytes,{flag:'wx',mode:0o600});
  must(canonical(dependencyFiles(path.join(pending,'node_modules'),{privateTree:true,platform}))===canonical(files),'CACHE_COPY_MISMATCH');
  fs.renameSync(pending,final);
  verifyCache({cacheHome,manifestSha256,packageRoot,runnerRoot,nodeVersion,platform});
  return {manifestSha256,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),reusedVerifiedCache:false};
}
export function verifyCache({cacheHome,manifestSha256,packageRoot,runnerRoot,nodeVersion=process.version,platform=process.platform}) {
  digest(manifestSha256,'CACHE_MANIFEST_DIGEST_REQUIRED');
  const folder=path.join(cacheBase(cacheHome,platform),manifestSha256);directory(folder);
  if(platform==='linux')must(fs.statSync(folder).uid===process.getuid()&&(fs.statSync(folder).mode&0o077)===0,'CACHE_PERMISSIONS_INVALID');
  const manifestFile=path.join(folder,'manifest.json');
  if(platform==='linux')must(fs.statSync(manifestFile).uid===process.getuid()&&(fs.statSync(manifestFile).mode&0o077)===0,'CACHE_PERMISSIONS_INVALID');
  const bytes=readRegular(manifestFile,8388608);must(sha256(bytes)===manifestSha256,'CACHE_MANIFEST_HASH_MISMATCH');
  const manifest=validateManifest(JSON.parse(bytes),{packageRoot,runnerRoot,nodeVersion});
  must(canonical(dependencyFiles(path.join(folder,'node_modules'),{privateTree:true,platform}))===canonical(manifest.files),'CACHE_FILES_MISMATCH');
  must(canonical(fs.readdirSync(folder).sort())===canonical(['manifest.json','node_modules']),'CACHE_EXTRA_FILE');
  return {folder,manifest};
}
export function materializeCache({cacheHome,manifestSha256,packageRoot,runnerRoot,runDirectory,nodeVersion=process.version,platform=process.platform}) {
  const {folder,manifest}=verifyCache({cacheHome,manifestSha256,packageRoot,runnerRoot,nodeVersion,platform});
  directory(runDirectory);
  const runtimeRoot=path.join(runDirectory,'toolchain');must(!fs.existsSync(runtimeRoot),'TOOLCHAIN_ALREADY_EXISTS');fs.mkdirSync(runtimeRoot,{mode:0o700});
  copyFiles(path.join(folder,'node_modules'),path.join(runtimeRoot,'node_modules'),manifest.files);
  fs.writeFileSync(path.join(runtimeRoot,'package.json'),'{"private":true}\n',{flag:'wx',mode:0o600});
  must(canonical(dependencyFiles(path.join(runtimeRoot,'node_modules'),{privateTree:true,platform}))===canonical(manifest.files),'TOOLCHAIN_COPY_MISMATCH');
  return {runtimeRoot,cacheManifestSha256:manifestSha256};
}
