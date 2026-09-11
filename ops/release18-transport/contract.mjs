import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const FROZEN_BINDING = 'c74ce2ef9946377b793a723ea0efc6b4fbbd0210fc84d4882b47d54568b6271f';
export const CLI_SHA256 = '69a2bd6412521259b90c653aff9822b6d2fc63a17f9c46d46d07d319ea0dbb3e';
export const ENGINE_SHA256 = '5d42b181631fd20bb0ecc5abcdba72575e7f467a0d52f4d5ef1ff28f0c74e6e9';
export const CA_SHA256 = '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';
export const TARGET = Object.freeze({ project:'mnfiixtgnlzmduunfryt', host:'aws-0-ap-southeast-1.pooler.supabase.com', port:5432, database:'postgres', user:'postgres.mnfiixtgnlzmduunfryt', transport:'session' });
export const SERVICE = 'srv-dagsvgek1f9s73dqpg7g';
export const RUN_MS = 120000;
export const SQL_MS = 60000;
export const CLEANUP_MS = 5000;
export const HASH = /^[a-f0-9]{64}$/;
export const COMMIT = /^[a-f0-9]{40}$/;
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const RUNTIME_FILES = Object.freeze(['cache.mjs','capture.mjs','contract.mjs','prepare-cache.mjs','public-result.mjs','transport-approval.schema.json','transport.sql']);
const PASSWORD_KEY = 'RELEASE18_DB_ADMIN_PASSWORD';
const OMIT = new Set(['BASH_FUNC_copy_secret_files%%','BASH_FUNC_remove_secret_files%%']);
export class TransportError extends Error { constructor(code) { super(code); this.code=code; } }
export function must(value,code) { if(!value)throw new TransportError(code); }
export const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export const canonical=value=>JSON.stringify(value);
export function failureCode(error) { return error instanceof TransportError && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'TRANSPORT_CAPTURE_FAILED'; }
export function exact(value,keys,code) { must(value && Object.getPrototypeOf(value)===Object.prototype && Object.keys(value).length===keys.length && keys.every(k=>Object.hasOwn(value,k)),code); }
export function utc(value) { must(typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString()===value,'UTC_INVALID');return Date.parse(value); }
export function digest(value,code='HASH_INVALID') { must(typeof value==='string' && value.length===64 && HASH.test(value),code); }
export function readRegular(file,max=131072) {
  const full=path.resolve(file),stat=fs.lstatSync(full);
  must(stat.isFile() && stat.nlink===1 && !stat.isSymbolicLink() && stat.size<=max && fs.realpathSync(full)===full,'FILE_INVALID');
  return fs.readFileSync(full);
}
export function directory(dir) {
  const full=path.resolve(dir),stat=fs.lstatSync(full);
  must(stat.isDirectory()&&!stat.isSymbolicLink()&&fs.realpathSync(full)===full,'DIRECTORY_INVALID');return full;
}
export function sourceSnapshot(runnerRoot) {
  return sha256(canonical(RUNTIME_FILES.map(name=>{const bytes=readRegular(path.join(runnerRoot,name),1048576);return [name,bytes.length,sha256(bytes)];})));
}
export function frozenPackage(packageRoot) {
  directory(packageRoot);
  const bytes=readRegular(path.join(packageRoot,'release-binding.json'));
  must(sha256(bytes)===FROZEN_BINDING,'FROZEN_BINDING_MISMATCH');
  const b=JSON.parse(bytes);
  must(b.files.length===50 && b.migrations.length===18,'FROZEN_PACKAGE_INVALID');
  const collect=(dir,prefix='')=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    if(!prefix && ['node_modules','evidence','release-binding.json'].includes(entry.name))return [];
    must(!entry.isSymbolicLink(),'SYMLINK_FORBIDDEN');
    const name=prefix?prefix+'/'+entry.name:entry.name;
    return entry.isDirectory()?collect(path.join(dir,entry.name),name):[name];
  }).sort();
  must(canonical(collect(packageRoot))===canonical(b.files.map(f=>f.path).sort()),'FROZEN_FILE_SET_MISMATCH');
  for(const f of b.files) { const value=readRegular(path.join(packageRoot,f.path),33554432);must(value.length===f.bytes && sha256(value)===f.sha256,'FROZEN_SOURCE_MISMATCH'); }
  return {sourceBindingSha256:FROZEN_BINDING,contractSha256:sha256(readRegular(path.join(packageRoot,'contract.mjs')))};
}
export function environmentGuard(env) {
  for(const key of Object.keys(env)) {
    if(OMIT.has(key))continue; // Never evaluate provider function bodies.
    if(key===PASSWORD_KEY)continue;
    must(!/(PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|PRIVATE_KEY|ACCESS_KEY|API_KEY|DATABASE_URL|DIRECT_URL)/i.test(key),'AMBIENT_CREDENTIAL_FORBIDDEN');
    must(!/^(?:PG|STAGING_|PRISMA_|NPM_CONFIG_|npm_config_|DOTENV_|NODE_OPTIONS$|NODE_EXTRA_CA_CERTS$|NODE_TLS_REJECT_UNAUTHORIZED$|SSL_CERT_|OPENSSL_CONF$|DEBUG$|LD_PRELOAD$|LD_LIBRARY_PATH$|DYLD_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NO_PROXY$)/i.test(key),'AMBIENT_CONFIGURATION_FORBIDDEN');
    must(!key.startsWith('RELEASE18_')||key==='RELEASE18_TRANSPORT_APPROVED_CONFIG_SHA256','AMBIENT_CONFIGURATION_FORBIDDEN');
  }
}
export function cleanEnvironment(env) {
  const clean={};
  for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','TMPDIR','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','LANG','LC_ALL']) if(typeof env[key]==='string')clean[key]=env[key];
  return {...clean,CHECKPOINT_DISABLE:'1',PRISMA_HIDE_UPDATE_MESSAGE:'1',NO_COLOR:'1'};
}
export function argumentsFor(argv) {
  must(argv.length===5 && argv[0]==='capture' && argv[1]==='--approval-file' && argv[3]==='--run-id','ARGUMENT_INVALID');
  must(path.isAbsolute(argv[2]) && typeof argv[4]==='string' && argv[4].length===36 && UUID.test(argv[4]),'ARGUMENT_INVALID');
  return {file:argv[2],runId:argv[4]};
}
export function approval(a,c) {
  exact(a,['schemaVersion','authority','command','runId','opsRevision','serviceId','target','sourceBindingSha256','runnerSourceSha256','toolchainCacheManifestSha256','validFrom','expiresAt','gates','controlledTlsProof','projectionMode','databaseMutation','applicationDeployment','unknownRunPolicy'],'APPROVAL_SHAPE_INVALID');
  must(a.schemaVersion===1 && a.authority==='F01_INDEPENDENT_TRANSPORT_REVIEW' && a.command==='CAPTURE_STAGE_READ_ONLY','APPROVAL_AUTHORITY_INVALID');
  must(a.runId===c.runId && UUID.test(a.runId) && a.runId.length===36 && a.opsRevision===c.opsRevision && a.opsRevision.length===40 && COMMIT.test(a.opsRevision) && a.serviceId===SERVICE && c.serviceId===SERVICE,'APPROVAL_INVOCATION_MISMATCH');
  exact(a.target,Object.keys(TARGET),'APPROVAL_TARGET_INVALID');
  must(Object.keys(TARGET).every(k=>a.target[k]===TARGET[k]),'APPROVAL_TARGET_INVALID');
  must(a.sourceBindingSha256===FROZEN_BINDING && a.runnerSourceSha256===c.runnerSourceSha256,'APPROVAL_SOURCE_MISMATCH');
  digest(a.toolchainCacheManifestSha256,'CACHE_MANIFEST_DIGEST_REQUIRED');
  const from=utc(a.validFrom),until=utc(a.expiresAt);
  must(from<=c.now && until>c.now+600000 && until-from<=1800000,'APPROVAL_WINDOW_INVALID');
  must(Array.isArray(a.gates)&&a.gates.length===5,'APPROVAL_GATES_INVALID');
  for(const role of ['E03','E04','E01','D04','F01']) {
    const entries=a.gates.filter(g=>g.role===role);must(entries.length===1,'APPROVAL_GATES_INVALID');
    const g=entries[0];exact(g,['role','status','evidenceSha256','sourceBindingSha256','runnerSourceSha256'],'APPROVAL_GATES_INVALID');
    digest(g.evidenceSha256);must(g.status==='PASSED'&&g.sourceBindingSha256===FROZEN_BINDING&&g.runnerSourceSha256===c.runnerSourceSha256,'APPROVAL_GATES_INVALID');
  }
  const p=a.controlledTlsProof;
  exact(p,['status','evidenceSha256','operationsCommit','serviceId','sourceBindingSha256','contractSha256','nodePlatform','prismaVersion','cliSha256','engineSha256','caSha256','validPeer','wrongCaRejectedBeforeCredentials','wrongHostnameRejectedBeforeCredentials','noTlsRejectedBeforeCredentials','noPlaintextFallback','observedAt'],'CONTROLLED_PROOF_INVALID');
  digest(p.evidenceSha256);
  must(p.status==='PASSED'&&p.operationsCommit.length===40&&COMMIT.test(p.operationsCommit)&&p.serviceId===SERVICE&&p.sourceBindingSha256===FROZEN_BINDING&&p.contractSha256===c.contractSha256,'CONTROLLED_PROOF_INVALID');
  must(p.nodePlatform==='linux'&&p.prismaVersion==='6.19.2'&&p.cliSha256===CLI_SHA256&&p.engineSha256===ENGINE_SHA256&&p.caSha256===CA_SHA256,'CONTROLLED_PROOF_RUNTIME_MISMATCH');
  must(['validPeer','wrongCaRejectedBeforeCredentials','wrongHostnameRejectedBeforeCredentials','noTlsRejectedBeforeCredentials','noPlaintextFallback'].every(k=>p[k]===true),'CONTROLLED_PROOF_CHECKS_MISSING');
  const observed=utc(p.observedAt);must(observed<=c.now&&c.now-observed<=86400000,'CONTROLLED_PROOF_STALE');
  must(['SUMMARY_ONLY','REVIEWED_SANITIZED_PROOF'].includes(a.projectionMode),'PROJECTION_MODE_INVALID');
  must(a.databaseMutation===false&&a.applicationDeployment===false&&a.unknownRunPolicy==='STOP_AND_REVIEW_NO_AUTOMATIC_RETRY','APPROVAL_POLICY_INVALID');
  return a;
}
export function resultEvidence(context) {
  const {runId,opsRevision,runnerSourceSha256,configSha256,toolchainCacheManifestSha256,contractSha256,controlledTlsProof,startedAt,observedAt}=context;
  return {schemaVersion:1,kind:'DB18_STAGE_PRISMA_READ_ONLY_TRANSPORT',runId,opsRevision,serviceId:SERVICE,sourceBindingSha256:FROZEN_BINDING,runnerSourceSha256,approvedConfigSha256:configSha256,toolchainCacheManifestSha256,target:{...TARGET},nodePlatform:'linux',prismaVersion:'6.19.2',cliSha256:CLI_SHA256,engineSha256:ENGINE_SHA256,caSha256:CA_SHA256,contractSha256,startedAt,observedAt,actualTarget:{status:'PASSED',validPeer:true,databaseTls:true,timezone:'UTC',lockTimeoutMs:5000,statementTimeoutMs:120000,readOnlyTransaction:true,invocationTagMatched:true},controlledNegativeEvidence:{evidenceSha256:controlledTlsProof.evidenceSha256,operationsCommit:controlledTlsProof.operationsCommit,observedAt:controlledTlsProof.observedAt,sourceBindingSha256:FROZEN_BINDING,wrongCaRejectedBeforeCredentials:true,wrongHostnameRejectedBeforeCredentials:true,noTlsRejectedBeforeCredentials:true,noPlaintextFallback:true,scope:'PREVIOUS_INDEPENDENTLY_ACCEPTED_CONTROLLED_PEERS_NOT_TARGET_NEGATIVE_TESTS'},databaseMutation:false,applicationDeployment:false};
}
export function proofProjection(e) {
  return {status:'PASSED',evidenceSha256:sha256(canonical(e)),sourceBindingSha256:FROZEN_BINDING,contractSha256:e.contractSha256,project:TARGET.project,host:TARGET.host,transport:TARGET.transport,nodePlatform:'linux',prismaVersion:'6.19.2',cliSha256:CLI_SHA256,engineSha256:ENGINE_SHA256,caSha256:CA_SHA256,validPeer:true,wrongCaRejectedBeforeCredentials:true,wrongHostnameRejectedBeforeCredentials:true,noTlsRejectedBeforeCredentials:true,noPlaintextFallback:true,databaseTls:true,timezone:'UTC',lockTimeoutMs:5000,statementTimeoutMs:120000,observedAt:new Date(Math.min(utc(e.observedAt),utc(e.controlledNegativeEvidence.observedAt))).toISOString()};
}

export function checkedProjection(e,p) {
  must(e && typeof e==='object' && e.runId?.length===36 && UUID.test(e.runId) && e.opsRevision?.length===40 && COMMIT.test(e.opsRevision),'PROJECTION_RECORD_INVALID');
  for(const value of [e.runnerSourceSha256,e.approvedConfigSha256,e.toolchainCacheManifestSha256,e.contractSha256,e.controlledNegativeEvidence?.evidenceSha256])digest(value,'PROJECTION_RECORD_INVALID');
  must(e.controlledNegativeEvidence?.operationsCommit?.length===40 && COMMIT.test(e.controlledNegativeEvidence.operationsCommit),'PROJECTION_RECORD_INVALID');
  must(utc(e.startedAt)<=utc(e.observedAt) && utc(e.controlledNegativeEvidence.observedAt)<=utc(e.observedAt),'PROJECTION_RECORD_INVALID');
  const safe=resultEvidence({runId:e.runId,opsRevision:e.opsRevision,runnerSourceSha256:e.runnerSourceSha256,configSha256:e.approvedConfigSha256,toolchainCacheManifestSha256:e.toolchainCacheManifestSha256,contractSha256:e.contractSha256,controlledTlsProof:{evidenceSha256:e.controlledNegativeEvidence.evidenceSha256,operationsCommit:e.controlledNegativeEvidence.operationsCommit,observedAt:e.controlledNegativeEvidence.observedAt},startedAt:e.startedAt,observedAt:e.observedAt});
  must(canonical(safe)===canonical(e),'PROJECTION_RECORD_INVALID');
  const proof=proofProjection(safe);
  must(canonical(proof)===canonical(p),'PROJECTION_PROOF_INVALID');
  return {evidence:safe,prismaTransportProof:proof};
}
