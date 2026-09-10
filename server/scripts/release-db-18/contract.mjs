import { isAbsolute, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { APPLICATION, HASH, PRISMA, ROOT, UUID, must, readRegular, sha256, utc } from './core.mjs';

export const PROFILES = Object.freeze({
  STAGE_EMPTY: Object.freeze({ baseline: 0, project: 'mnfiixtgnlzmduunfryt' }),
  STAGE_15: Object.freeze({ baseline: 15, project: 'mnfiixtgnlzmduunfryt' }),
  PROD_10: Object.freeze({ baseline: 10, project: 'jlanmsxfggpnbwoowejy' })
});
export const CLI_SHA256 = '69a2bd6412521259b90c653aff9822b6d2fc63a17f9c46d46d07d319ea0dbb3e';
export const LINUX_ENGINE_SHA256 = '5d42b181631fd20bb0ecc5abcdba72575e7f467a0d52f4d5ef1ff28f0c74e6e9';
export const CA_SHA256 = '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';
export const CONNECTION_OPTIONS = '-c timezone=UTC -c lock_timeout=5000 -c statement_timeout=120000';
export const LIMITS = Object.freeze({ PREFLIGHT: 60000, MIGRATE_DEPLOY: 360000, POSTFLIGHT: 60000 });
export const RUN_BUDGET_MS = 600000;
export const CLEANUP_RESERVE_MS = 15000;
const OS_KEYS = ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','TMPDIR','HOME','USERPROFILE','APPDATA','LOCALAPPDATA'];

export function profile(name) { must(Object.hasOwn(PROFILES, name ?? ''), 'PROFILE_INVALID'); return PROFILES[name]; }
export function localDatabase(name) {
  must(typeof name === 'string' && /^si_release18_[a-z0-9_]{1,40}(?![\s\S])/.test(name), 'LOCAL_DATABASE_INVALID');
  return name;
}
export function targetFor(name, transport = 'direct', localName) {
  const selected = profile(name);
  if (localName !== undefined) return { project: 'LOCAL_SYNTHETIC_ONLY', host: '127.0.0.1', port: 55447, database: localDatabase(localName), user: 'postgres', transport: 'local', local: true };
  must(transport === 'direct' || (name !== 'PROD_10' && transport === 'session'), 'TRANSPORT_INVALID');
  return { project: selected.project, host: transport === 'direct' ? `db.${selected.project}.supabase.co` : 'aws-0-ap-southeast-1.pooler.supabase.com', port: 5432, database: 'postgres', user: transport === 'direct' ? 'postgres' : `postgres.${selected.project}`, transport, local: false };
}
export function rejectInherited(env) {
  // Inspect names only; never evaluate a getter or print a secret value.
  for (const key of Object.keys(env)) {
    must(!/^(?:DATABASE_URL|DIRECT_URL|NODE_OPTIONS|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|SSL_CERT_FILE|SSL_CERT_DIR|OPENSSL_CONF|DEBUG|PG[A-Z_]*|PRISMA_(?:SCHEMA_ENGINE_BINARY|QUERY_ENGINE_BINARY|QUERY_ENGINE_LIBRARY|ENGINES_MIRROR)|SUPABASE_ACCESS_TOKEN|STAGING_DB_.*)$/.test(key), 'INHERITED_CONFIGURATION_FORBIDDEN');
  }
}
export function assertCredentialFree(env) {
  for(const key of Object.keys(env)) must(!/(PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|PRIVATE_KEY|ACCESS_KEY|DATABASE_URL|DIRECT_URL|API_KEY|^PG)/i.test(key),'VERIFY_CREDENTIAL_CONFIGURATION_PRESENT');
}
export function childEnvironment(env, url) {
  const clean = {};
  for (const key of OS_KEYS) if (typeof env[key] === 'string') clean[key] = env[key];
  return { ...clean, DATABASE_URL: url, DIRECT_URL: url, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', NO_COLOR: '1' };
}
export function connectionUrl(target, password, caFile) {
  must(typeof password === 'string' && password.length > 0 && password.length <= 4096 && !/[\u0000\r\n]/.test(password), 'PASSWORD_INVALID');
  const url = new URL(`postgresql://${target.host}:${target.port}/${target.database}`);
  url.username = target.user;
  url.password = encodeURIComponent(password);
  url.searchParams.set('schema', 'public');
  url.searchParams.set('connect_timeout', '10');
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('options', CONNECTION_OPTIONS);
  if (target.local) url.searchParams.set('sslmode', 'disable');
  else {
    must(typeof caFile === 'string' && isAbsolute(caFile), 'CA_PATH_INVALID');
    url.searchParams.set('sslmode', 'require');
    url.searchParams.set('sslaccept', 'strict');
    url.searchParams.set('sslcert', caFile);
  }
  return url.href;
}
export function validateApproval(a, context) {
  const { binding, target, command, runId, now = Date.now(), opsRevision, serviceId } = context;
  must(a && a.schemaVersion === 1 && a.authority === 'F01_INDEPENDENT_RELEASE_REVIEW', 'APPROVAL_SCHEMA_INVALID');
  const allowed=['schemaVersion','authority','application','sourceBindingSha256','opsRevision','command','runId','profile','project','host','port','database','user','transport','serviceId','validFrom','expiresAt','gates','prismaTransportProof','applicationDeployment','unknownRunPolicy','fence','backup','runtimeJournalAclPlanReviewed','runtimeJournalAclEvidenceSha256','stageAcceptanceEvidenceSha256','baselineCaptureApproved'];
  must(Object.keys(a).every(key=>allowed.includes(key)), 'APPROVAL_UNKNOWN_FIELD');
  must(a.application === APPLICATION && a.sourceBindingSha256 === binding.bindingSha256 && a.opsRevision === opsRevision, 'APPROVAL_SOURCE_MISMATCH');
  must(a.command === command && a.runId === runId && UUID.test(a.runId) && a.profile === context.profile, 'APPROVAL_RUN_MISMATCH');
  must(a.project === target.project && a.host === target.host && a.port === target.port && a.database === target.database && a.user === target.user && a.transport === target.transport, 'APPROVAL_TARGET_MISMATCH');
  must(typeof serviceId === 'string' && /^srv-[a-z0-9]+$/.test(serviceId) && a.serviceId === serviceId, 'APPROVAL_SERVICE_MISMATCH');
  const from = utc(a.validFrom), expires = utc(a.expiresAt);
  must(from <= now && expires > now + RUN_BUDGET_MS && expires - from <= 30 * 60000, 'APPROVAL_EXPIRED_OR_UNBOUNDED');
  must(Array.isArray(a.gates) && a.gates.length===5, 'GATES_MISSING');
  for (const role of ['E03','E04','E01','D04','F01']) {
    const g = a.gates.filter(item => item.role === role);
    must(g.length === 1 && g[0].status === 'PASSED' && HASH.test(g[0].evidenceSha256) && g[0].sourceBindingSha256 === binding.bindingSha256, 'INDEPENDENT_GATE_MISSING');
    must(Object.keys(g[0]).every(key=>['role','status','evidenceSha256','sourceBindingSha256'].includes(key)), 'APPROVAL_UNKNOWN_FIELD');
  }
  const p = a.prismaTransportProof;
  must(p && p.status === 'PASSED' && HASH.test(p.evidenceSha256) && p.sourceBindingSha256 === binding.bindingSha256 && p.contractSha256 === sha256(readRegular(resolve(ROOT, 'contract.mjs'))), 'PRISMA_PROOF_MISSING');
  must(Object.keys(p).every(key=>['status','evidenceSha256','sourceBindingSha256','contractSha256','project','host','transport','nodePlatform','prismaVersion','cliSha256','engineSha256','caSha256','validPeer','wrongCaRejectedBeforeCredentials','wrongHostnameRejectedBeforeCredentials','noTlsRejectedBeforeCredentials','noPlaintextFallback','databaseTls','timezone','lockTimeoutMs','statementTimeoutMs','observedAt'].includes(key)), 'APPROVAL_UNKNOWN_FIELD');
  must(p.project === target.project && p.host === target.host && p.transport === target.transport && p.nodePlatform === 'linux' && p.prismaVersion === PRISMA && p.cliSha256 === CLI_SHA256 && p.engineSha256 === LINUX_ENGINE_SHA256 && p.caSha256 === CA_SHA256, 'PRISMA_PROOF_BINDING_INVALID');
  must(p.validPeer === true && p.wrongCaRejectedBeforeCredentials === true && p.wrongHostnameRejectedBeforeCredentials === true && p.noTlsRejectedBeforeCredentials === true && p.noPlaintextFallback === true && p.databaseTls === true && p.timezone === 'UTC' && p.lockTimeoutMs === 5000 && p.statementTimeoutMs === 120000, 'PRISMA_PROOF_CHECKS_MISSING');
  must(utc(p.observedAt) <= now && now - utc(p.observedAt) <= 24 * 3600000, 'PRISMA_PROOF_STALE');
  must(a.applicationDeployment === false && a.unknownRunPolicy === 'STOP_AND_INSPECT_NO_AUTOMATIC_RETRY', 'APPROVAL_POLICY_INVALID');
  if (command === 'deploy') {
    const f = a.fence, b = a.backup;
    must(f && f.active === true && f.project === target.project && f.allApplicationWritersStopped === true && f.cronStopped === true && f.socketStopped === true && f.mediaWritersStopped === true && HASH.test(f.evidenceSha256), 'FENCE_REQUIRED');
    must(utc(f.observedAt) <= now && now - utc(f.observedAt) <= 5 * 60000 && utc(f.expiresAt) >= expires, 'FENCE_STALE');
    must(b && b.project === target.project && b.verified === true && b.restoreVerified === true && b.journalCoverageVerified === true && HASH.test(b.evidenceSha256), 'BACKUP_REQUIRED');
    must(Object.keys(f).every(key=>['active','project','allApplicationWritersStopped','cronStopped','socketStopped','mediaWritersStopped','evidenceSha256','observedAt','expiresAt'].includes(key)) && Object.keys(b).every(key=>['project','verified','restoreVerified','journalCoverageVerified','evidenceSha256','completedAt'].includes(key)), 'APPROVAL_UNKNOWN_FIELD');
    must(utc(b.completedAt) <= now && now - utc(b.completedAt) <= 24 * 3600000, 'BACKUP_STALE');
    must(a.runtimeJournalAclPlanReviewed === true && HASH.test(a.runtimeJournalAclEvidenceSha256), 'RUNTIME_ACL_PLAN_REQUIRED');
    if (context.profile === 'PROD_10') must(HASH.test(a.stageAcceptanceEvidenceSha256), 'STAGE_ACCEPTANCE_REQUIRED');
    must(a.baselineCaptureApproved === true, 'FENCED_BASELINE_REQUIRED');
  }
  return a;
}
export function readHostedApproval({ env, file, binding, target, command, runId, profile: name }) {
  must(process.platform === 'linux', 'HOSTED_LINUX_REQUIRED');
  must(typeof file === 'string' && isAbsolute(file) && HASH.test(env.RELEASE18_APPROVED_CONFIG_SHA256 ?? ''), 'TRUSTED_CONFIG_BINDING_REQUIRED');
  const bytes = readRegular(file, 128 * 1024);
  must(sha256(bytes) === env.RELEASE18_APPROVED_CONFIG_SHA256, 'TRUSTED_CONFIG_HASH_MISMATCH');
  const repository = resolve(ROOT, '../../..');
  const git = spawnSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  must(git.status === 0 && !git.error && /^[a-f0-9]{40}\s*$/.test(git.stdout), 'OPS_REVISION_UNAVAILABLE');
  const opsRevision = git.stdout.trim();
  must(env.RENDER_GIT_COMMIT === opsRevision, 'OPS_REVISION_MISMATCH');
  return validateApproval(JSON.parse(bytes), { binding, target, command, runId, profile: name, opsRevision, serviceId: env.RENDER_SERVICE_ID });
}
export function assertNoAmbientDotenv(cwd) {
  for (const path of ['.env','prisma/.env','prisma.config.js','prisma.config.ts','prisma.config.mjs','prisma.config.cjs']) must(!existsSync(resolve(cwd, path)), 'ENV_FILE_FORBIDDEN');
}
