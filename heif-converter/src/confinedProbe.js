import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';

const [input,decoded]=process.argv.slice(2), checks=[];
function check(name,pass){if(!pass)throw Object.assign(new Error(name),{probeCheck:name.replaceAll('-','_').toUpperCase()});checks.push(name);}
function denied(name,fn){let blocked=false;try{fn();}catch(e){blocked=['EACCES','EPERM'].includes(e.code);}check(name,blocked);}
try {
  check('uid',process.getuid()===10001);
  check('environment',Object.keys(process.env).sort().join(',')==='LANG,LC_ALL,MALLOC_ARENA_MAX,NODE_ENV,TZ,UV_THREADPOOL_SIZE,UV_USE_IO_URING');
  // Inspect exec's environment before loading native libraries, which may set
  // their own process-local configuration variables during initialization.
  const sharp=(await import('sharp')).default;
  check('input-read',fs.readFileSync(input).length>=0);
  denied('input-write',()=>fs.writeFileSync(input,'changed'));
  denied('outside-read',()=>fs.readFileSync('/etc/passwd'));
  denied('proc-read',()=>fs.readFileSync('/proc/self/environ'));
  denied('code-write',()=>fs.writeFileSync('/app/src/confinedProbe.js','changed'));
  denied('create-file',()=>fs.writeFileSync(process.cwd()+'/extra','changed'));
  denied('create-directory',()=>fs.mkdirSync(process.cwd()+'/extra-dir'));
  denied('rename',()=>fs.renameSync(input,process.cwd()+'/moved'));
  denied('hardlink',()=>fs.linkSync(input,process.cwd()+'/linked'));
  denied('symlink',()=>fs.symlinkSync(input,process.cwd()+'/symlink'));
  fs.writeFileSync(decoded,'positive-precreated-inode');
  check('decoded-write',fs.readFileSync(decoded,'utf8')==='positive-precreated-inode');
  fs.truncateSync(decoded,0);
  check('decoded-truncate',fs.statSync(decoded).size===0);
  const syscallReport=await new Promise((resolve,reject)=>{
    const p=spawn('/usr/local/bin/si-heif-confine',['--syscall-probe',String(process.pid)],{stdio:['ignore','pipe','ignore'],env:{}});
    let result='';p.stdout.on('data',b=>{result+=b.toString();if(result.length>512)reject(new Error('SYSCALL_PROBE_OUTPUT'));});
    p.once('error',reject);p.once('close',code=>{try{code===0?resolve(JSON.parse(result)):reject(Object.assign(new Error('SYSCALL_PROBE'),{probeCheck:'SYSCALL_PROBE'}));}catch(e){reject(e);}});
  });
  check('syscall-boundary',syscallReport.status==='PASS'&&syscallReport.negativeSyscalls===30&&syscallReport.limitsVerified===5);
  // A newly detached process would escape cancellation's process-group boundary.
  const escapeDenied=await new Promise(resolve=>{
    const p=spawn('/usr/local/bin/si-heif-confine',['--group-probe',String(process.pid)],{detached:true,stdio:['ignore','pipe','ignore'],env:{}});
    let result='';p.stdout.on('data',b=>{result+=b.toString();if(result.length>512)resolve(false);});
    p.once('error',e=>resolve(e.code==='EPERM'));
    p.once('close',code=>{try{const identity=JSON.parse(result);resolve(code===0&&identity.group===process.pid&&identity.session===process.pid&&identity.pid!==process.pid);}catch{resolve(false);}});
  });
  check('group-escape',escapeDenied);
  const networkDenied=await new Promise(resolve=>{
    const socket=net.connect({host:'127.0.0.1',port:9});
    socket.once('error',e=>resolve(e.code==='EPERM'||e.code==='EACCES'));
    socket.once('connect',()=>{socket.destroy();resolve(false);});
    setTimeout(()=>{socket.destroy();resolve(false);},1000).unref();
  });
  check('network',networkDenied);
  sharp.cache(false);sharp.concurrency(1);
  const data=await sharp({create:{width:4,height:4,channels:4,background:'#33669980'}}).webp().toBuffer();
  const meta=await sharp(data).metadata();
  check('sharp-inside',meta.format==='webp'&&meta.width===4&&meta.height===4);
  const header=Buffer.from(JSON.stringify({ok:true,bytes:0,checks,syscallReport})),prefix=Buffer.alloc(4);
  prefix.writeUInt32BE(header.length);process.stdout.write(prefix);process.stdout.end(header);
} catch(error) {const code=String(error.probeCheck??error.code??'UNKNOWN');process.stderr.write('CONFINEMENT_PROBE_FAILED:'+(/^[A-Z_0-9]+$/.test(code)?code:'UNKNOWN')+'\n');process.exitCode=1;}
