// Credential-free fault fixture; no HTTP route imports or selects this file.
import { spawn } from 'node:child_process';
const mode=process.argv[4];
if(mode==='orphan'||mode==='hold') {
  const child=spawn('/usr/local/bin/si-heif-confine',['--fork-sleeper',mode,String(process.pid)],{env:{},stdio:['ignore','pipe','ignore']});
  child.stdout.once('data',data=>{
    const {descendant}=JSON.parse(data.toString());
    if(!Number.isSafeInteger(descendant)||descendant<2)process.exit(1);
    process.stderr.write('CONFINEMENT_LIFETIME:'+descendant+'\n');
  });
  child.on('error',()=>process.exit(1));
  setInterval(()=>{},1000);
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
