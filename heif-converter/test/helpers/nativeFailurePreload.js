// Test process only. Production worker code is imported unchanged after this
// redirect; the helper is a real child that exits, or a real failed spawn.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { writeSync } from 'node:fs';
const spawn=childProcess.spawn;
childProcess.spawn=(command,args,options)=>{
  if(command!=='/usr/local/bin/si-heif-confine')throw Error('Unexpected test executable');
  const outcome=process.env.SI_TEST_HELPER_OUTCOME;
  if(outcome==='spawn-throw')throw Error('Synthetic synchronous spawn failure');
  if(outcome==='spawn-error')return spawn(fileURLToPath(new URL('./missing-native-executable',import.meta.url)),[],options);
  return spawn(process.execPath,[fileURLToPath(new URL('./nativeExitFixture.js',import.meta.url)),outcome],options);
};
syncBuiltinESMExports();
if(process.env.SI_TEST_PAUSE_NATIVE_EXIT==='1') {
  const write=process.stderr.write.bind(process.stderr);
  process.stderr.write=(chunk,...args)=>{
    if(chunk==='CONFINEMENT_NATIVE_EXIT:78\n') {
      // Publish the real worker's earliest exit diagnostic, then hold its JS
      // continuation so the broker must classify before any later FAILURE/frame.
      writeSync(2,chunk);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000);
      return true;
    }
    return write(chunk,...args);
  };
}
