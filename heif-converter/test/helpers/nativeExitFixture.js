// Local lifecycle fixture only, not a native confinement or orphan-reaping proof.
const outcome=process.argv[2];
if(outcome==='orphan-close') {
  process.stdout.write(JSON.stringify({descendant:process.pid})+'\n');
  process.exitCode=0;
} else process.exitCode=outcome==='exit78'?78:1;
