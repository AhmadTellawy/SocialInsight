// Credential-free fault fixture; no HTTP route imports or selects this file.
import { spawn } from 'node:child_process';
const mode=process.argv[4];
function spawnHelper() {
  try{return spawn('/usr/local/bin/si-heif-confine',['--fault-helper',process.cwd(),mode,String(process.pid)],{env:{},stdio:['ignore','pipe','ignore']});}
  catch{process.exit(78);}
}
function observeHelper(child) {
  // The child handle keeps a held fixture alive. Once it closes, the worker
  // must close too so the broker can kill/reap the remaining synthetic group.
  child.once('error',()=>{process.exitCode=78;});
  child.once('close',code=>{if(process.exitCode!==78)process.exitCode=code===78?78:1;});
}
if(mode==='fork-exhaust'||mode==='thread-exhaust') {
  const child=spawnHelper();
  let output='';child.stdout.on('data',data=>{output+=data.toString();if(output.length>1024)process.exit(1);if(output.endsWith('\n'))process.stderr.write('CONFINEMENT_EXHAUSTION:'+output);});
  observeHelper(child);
} else if(mode==='orphan'||mode==='hold') {
  const child=spawnHelper();
  child.stdout.once('data',data=>{
    const {descendant}=JSON.parse(data.toString());
    if(!Number.isSafeInteger(descendant)||descendant<2)process.exit(1);
    process.stderr.write('CONFINEMENT_LIFETIME:'+descendant+'\n');
  });
  observeHelper(child);
} else if(mode==='hang') {
  // Includes the actual native Sharp module in the bounded worker lifetime.
  const sharp=(await import('sharp')).default;
  await sharp({create:{width:4,height:4,channels:4,background:'#112233ff'}}).webp().toBuffer();
  setInterval(()=>{},1000);
} else if(mode==='stdout'||mode==='stderr') {
  const stream=mode==='stdout'?process.stdout:process.stderr;
  const data=Buffer.alloc(mode==='stdout'?65536:4096,120);
  for(;;) {if(!stream.write(data))await new Promise(resolve=>stream.once('drain',resolve));}
} else process.exit(1);
