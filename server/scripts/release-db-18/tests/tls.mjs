// Credential-free controlled TLS peer. This is not hosted transport verification.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, must, readRegular, sanitizedFailure, sha256, verifyBundle } from '../core.mjs';
import { childEnvironment } from '../contract.mjs';
import { verifyRuntime } from '../install.mjs';

try {
  must(process.argv.length===2,'ARGUMENT_INVALID');
  for(const key of Object.keys(process.env)) must(!/(PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|PRIVATE_KEY|ACCESS_KEY|DATABASE_URL|DIRECT_URL|API_KEY|^PG)/i.test(key),'TLS_TEST_CREDENTIAL_CONFIGURATION_PRESENT');
  const binding=verifyBundle();
  const runtimeRoot=process.platform==='linux'?ROOT:resolve(ROOT,'../../../../account-settings/server');
  const runtime=verifyRuntime(runtimeRoot,process.platform!=='linux');
  const candidates=process.platform==='win32'?['C:/Program Files/Git/usr/bin/openssl.exe','C:/Program Files/Git/mingw64/bin/openssl.exe']:['/usr/bin/openssl','/usr/local/bin/openssl'];
  const openssl=candidates.find(existsSync); must(openssl,'OPENSSL_REQUIRED');
  const result=resolve(ROOT,`evidence/tls-${randomUUID()}.json`);
  const clean=childEnvironment(process.env,'synthetic'); delete clean.DATABASE_URL; delete clean.DIRECT_URL;
  const run=spawnSync(process.execPath,[resolve(ROOT,'tests/tls-peer.mjs'),'--prisma-dir',resolve(runtimeRoot,'node_modules/prisma'),'--openssl',openssl,'--contract',resolve(ROOT,'contract.mjs'),'--result',result],{cwd:ROOT,env:clean,timeout:180000,encoding:'utf8',maxBuffer:65536,windowsHide:true,stdio:['ignore','pipe','pipe']});
  must(run.status===0 && !run.error && !run.signal,'TLS_HARNESS_FAILED');
  const receipt=JSON.parse(readRegular(result,128*1024));
  must(receipt.status==='PASSED' && receipt.cases.length===4 && receipt.cases.every(c=>c.status==='PASSED' && c.assertions.every(a=>a.passed)) && receipt.cases[0].startupOptionsMatched===true,'TLS_RECEIPT_FAILED');
  must(receipt.engine.sha256===runtime.engineSha256 && receipt.contractSha256===sha256(readRegular(resolve(ROOT,'contract.mjs'))) && receipt.cleanup.fixtureRemoved && receipt.cleanup.childTerminated && receipt.cleanup.remainingTrackedSockets===0,'TLS_RECEIPT_BINDING_FAILED');
  console.log(JSON.stringify({status:'PASSED',sourceBindingSha256:binding.bindingSha256,platform:process.platform,cases:4,assertions:receipt.cases.reduce((n,c)=>n+c.assertions.length,0),providerConnections:0,actualHostedTransportVerified:false,result}));
} catch(error) { console.error(JSON.stringify({status:'FAILED',failureCode:sanitizedFailure(error),providerConnections:0})); process.exitCode=1; }
