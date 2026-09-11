import test from 'node:test';
import assert from 'node:assert/strict';
import { runRelease18Verify, EXPECTED_BINDING, STAGE_SERVICE } from './run-release18-verify.mjs';
const base = { PATH: '/usr/bin', HOME: '/tmp/synthetic-home', RENDER_SERVICE_ID: STAGE_SERVICE, RENDER_GIT_COMMIT: 'a'.repeat(40), STAGING_INITIAL_INSTALL_MODE: 'verify' };
const fixture = () => {
  const calls=[]; const emissions=[];
  return { calls, emissions, options: { env:{...base}, platform:'linux', verify:()=>({bindingSha256:EXPECTED_BINDING}), run:(...args)=>{calls.push(args);return{status:0};}, emit:x=>emissions.push(JSON.parse(x)) } };
};
test('fixed Stage verify runs only pinned install, verify and controlled TLS, with no credentialed mode',()=>{
  const f=fixture();const result=runRelease18Verify(f.options);
  assert.equal(f.calls.length,3);assert.deepEqual(f.calls[0][1],['ci']);assert.equal(f.calls[1][1][1],'verify');assert.match(f.calls[2][1][0],/tests[\\/]tls\.mjs$/);
  for(const [,args,opt] of f.calls){assert.ok(!args.includes('deploy'));assert.ok(!args.includes('preflight'));assert.equal(opt.env.RENDER_SERVICE_ID,undefined);assert.equal(opt.env.STAGING_INITIAL_INSTALL_MODE,undefined);assert.equal(opt.env.PATH,base.PATH);assert.equal(opt.stdio,'inherit');}
  assert.equal(result.databaseMutation,false);assert.equal(result.actualHostedTransportVerified,false);assert.equal(result.sourceBindingSha256,EXPECTED_BINDING);
});
test('secret and hook names reject before dependency execution without reading values',()=>{
  for(const key of ['STAGING_DB_ADMIN_PASSWORD','DATABASE_URL','NODE_OPTIONS','OTHER_SECRET','NPM_TOKEN']){
    const f=fixture();Object.defineProperty(f.options.env,key,{enumerable:true,get(){assert.fail('secret getter accessed');}});
    assert.throws(()=>runRelease18Verify(f.options));assert.equal(f.calls.length,0);
  }
});
test('only previously approved provider function names are omitted without reading bodies',()=>{
  const f=fixture();for(const key of ['BASH_FUNC_copy_secret_files%%','BASH_FUNC_remove_secret_files%%'])Object.defineProperty(f.options.env,key,{enumerable:true,get(){assert.fail('function body read');}});
  runRelease18Verify(f.options);assert.equal(f.calls.length,3);
  const other=fixture();Object.defineProperty(other.options.env,'BASH_FUNC_other_secret%%',{enumerable:true,get(){assert.fail('body read');}});
  assert.throws(()=>runRelease18Verify(other.options));assert.equal(other.calls.length,0);
});
test('wrong platform, target, revision, mode or frozen package stops before any child',()=>{
  for(const change of [f=>f.options.platform='win32',f=>f.options.env.RENDER_SERVICE_ID='srv-production',f=>f.options.env.RENDER_GIT_COMMIT='a'.repeat(40)+'\n',f=>f.options.env.STAGING_INITIAL_INSTALL_MODE='deploy',f=>f.options.verify=()=>({bindingSha256:'0'.repeat(64)})]){
    const f=fixture();change(f);assert.throws(()=>runRelease18Verify(f.options));assert.equal(f.calls.length,0);
  }
});
test('each child error, signal, nonzero exit or missing result prevents later phases',()=>{
  for(const bad of [{status:1},{status:0,error:{code:'EACCES'}},{status:0,signal:'SIGTERM'},null])for(const phase of [0,1,2]){
    const f=fixture();let i=0;f.options.run=(...args)=>{f.calls.push(args);return i++===phase?bad:{status:0};};
    assert.throws(()=>runRelease18Verify(f.options));assert.equal(f.calls.length,phase+1);assert.equal(f.emissions.length,0);
  }
});
test('post-run binding drift prevents a successful verification receipt',()=>{
  const f=fixture();let i=0;f.options.verify=()=>({bindingSha256:i++? '0'.repeat(64):EXPECTED_BINDING});
  assert.throws(()=>runRelease18Verify(f.options));assert.equal(f.calls.length,3);assert.equal(f.emissions.length,0);
});
