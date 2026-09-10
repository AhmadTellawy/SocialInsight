import fs from 'node:fs/promises';
import path from 'node:path';
import { ServiceError } from './errors.js';

export const TEMP_ROOT='/tmp/heif-converter';
const unavailable=()=>new ServiceError(503,'CONFINEMENT_UNAVAILABLE','Image processing is unavailable');
const positive=value=>/^[1-9][0-9]*$/.test(value)&&Number.isSafeInteger(Number(value));

export async function verifyTempRoot(io=fs,{empty=true}={}) {
  if(await io.realpath(TEMP_ROOT)!==TEMP_ROOT)throw unavailable();
  for(const name of ['/','/tmp',TEMP_ROOT]) {
    const item=await io.lstat(name);
    if(!item.isDirectory()||item.isSymbolicLink())throw unavailable();
    if(name===TEMP_ROOT&&(item.uid!==10001||(item.mode&0o777)!==0o700))throw unavailable();
  }
  if(empty&&(await io.readdir(TEMP_ROOT)).length)throw unavailable();
  const disk=await io.statfs(TEMP_ROOT,{bigint:true});
  // Availability only: the hard two-inode/FSIZE boundary enforces write bounds.
  if(disk.bavail*disk.bsize<160n*1024n*1024n||disk.ffree<4n)throw unavailable();
  return {privateRoot:true,emptyRoot:empty,minimumFreeBytes:160*1024*1024,storage:'bounded-two-inode'};
}

export async function verifyResourceEnvelope(io=fs) {
  const memberships=(await io.readFile('/proc/self/cgroup','utf8')).trim().split('\n');
  const membership=memberships.find(line=>line.startsWith('0::'))?.slice(3);
  const mounts=(await io.readFile('/proc/self/mountinfo','utf8')).trim().split('\n').filter(line=>line.includes(' - cgroup2 '));
  if(!membership||mounts.length!==1)throw unavailable();
  const fields=mounts[0].split(' '),root=fields[3],mount=fields[4];
  if([membership,root,mount].some(value=>!value.startsWith('/')||value.includes('\\')||path.posix.normalize(value)!==value))throw unavailable();
  const relative=path.posix.relative(root,membership);
  if(relative.startsWith('..')||path.posix.isAbsolute(relative))throw unavailable();
  let current=path.posix.join(mount,relative),memory=Infinity,pids=Infinity,swap=Infinity,cpu=Infinity;
  for(;;) {
    const read=async name=>(await io.readFile(current+'/'+name,'utf8')).trim();
    for(const [name,set]of [['memory.max',n=>{memory=Math.min(memory,n);}],['pids.max',n=>{pids=Math.min(pids,n);}]]) {
      const value=await read(name);if(value!=='max'){if(!positive(value))throw unavailable();set(Number(value));}
    }
    const swapValue=await read('memory.swap.max');
    if(swapValue!=='max'){if(!/^[0-9]+$/.test(swapValue)||!Number.isSafeInteger(Number(swapValue)))throw unavailable();swap=Math.min(swap,Number(swapValue));}
    const [quota,period,...extra]=(await read('cpu.max')).split(/\s+/);
    if(extra.length||!positive(period)||(quota!=='max'&&!positive(quota)))throw unavailable();
    if(quota!=='max')cpu=Math.min(cpu,Number(quota)/Number(period));
    if(current===mount)break;
    const parent=path.posix.dirname(current);if(parent===current||!parent.startsWith(mount))throw unavailable();current=parent;
  }
  if(!Number.isFinite(memory)||memory>512*1024*1024||memory<256*1024*1024||swap!==0
    ||!Number.isFinite(pids)||pids>512||!Number.isFinite(cpu)||cpu<0.1)throw unavailable();
  const events=Object.fromEntries((await io.readFile(path.posix.join(mount,relative,'memory.events'),'utf8')).trim().split('\n').map(line=>line.split(/\s+/)));
  if(!/^[0-9]+$/.test(events.oom)||!/^[0-9]+$/.test(events.oom_kill))throw unavailable();
  return Object.freeze({memoryBytes:memory,swapBytes:swap,pids,cpuQuota:cpu,memoryEventsPath:path.posix.join(mount,relative,'memory.events'),oom:Number(events.oom),oomKill:Number(events.oom_kill)});
}

export async function verifyBootstrap({io=fs,supervisorMode='--supervise'}={}) {
  let phase='IDENTITY';
  try {
    if(process.platform!=='linux'||process.getuid()!==10001||process.geteuid()!==10001||process.getgid()!==10001||process.getegid()!==10001)throw unavailable();
    phase='CAPABILITIES';
    const status=await io.readFile('/proc/self/status','utf8');
    for(const name of ['CapEff','CapPrm','CapInh','CapAmb'])if(!new RegExp('^'+name+':\\s+0+$','m').test(status))throw unavailable();
    if(!/^NoNewPrivs:\s+1$/m.test(status))throw unavailable();
    phase='PROCESS_LIMIT';
    const limits=await io.readFile('/proc/self/limits','utf8');
    if(!/^Max processes\s+128\s+128\s+processes[ \t]*$/m.test(limits))throw unavailable();
    phase='SUPERVISOR';
    const parent=process.ppid;
    if(await io.readlink('/proc/'+parent+'/exe')!=='/usr/local/bin/si-heif-confine')throw unavailable();
    const argv=(await io.readFile('/proc/'+parent+'/cmdline','utf8')).split('\0').filter(Boolean);
    if(argv.length!==2||argv[1]!==supervisorMode)throw unavailable();
    phase='STORAGE';
    const storage=await verifyTempRoot(io);
    phase='RESOURCES';
    const resources=await verifyResourceEnvelope(io);
    if(process.ppid!==parent)throw unavailable();
    return Object.freeze({storage,resources});
  } catch {const error=unavailable();error.phase=phase;throw error;}
}
