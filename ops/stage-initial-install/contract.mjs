import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

export const COMMIT = '4d9daeacdd7c7f4cc7a67b3fc1331736597b0037';
export const PROJECT = 'mnfiixtgnlzmduunfryt';
export const PRISMA_VERSION = '6.19.2';
export const STAGE_CA_SHA256 = '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';
export const TARGETS = Object.freeze({
  direct: Object.freeze({ host: `db.${PROJECT}.supabase.co`, user: 'postgres' }),
  session: Object.freeze({ host: 'aws-0-ap-southeast-1.pooler.supabase.com', user: `postgres.${PROJECT}` })
});
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function connectionContract(env, caBytes) {
  // Never use inherited application credentials, arbitrary endpoints or JIT tokens.
  if (env.DATABASE_URL || env.DIRECT_URL || env.STAGING_DB_JIT_TOKEN || env.SUPABASE_ACCESS_TOKEN || env.NODE_OPTIONS || env.DEBUG) throw new Error('UNEXPECTED_INHERITED_CONFIGURATION');
  if (env.STAGING_INITIAL_INSTALL_PROJECT !== PROJECT) throw new Error('STAGE_TARGET_NOT_ACKNOWLEDGED');
  const transport = env.STAGING_DB_TRANSPORT;
  if (!Object.hasOwn(TARGETS, transport ?? '')) throw new Error('STAGE_TRANSPORT_INVALID');
  const password = env.STAGING_DB_ADMIN_PASSWORD;
  if (typeof password !== 'string' || password.length < 1 || /[\u0000\r\n]/u.test(password)) throw new Error('ADMIN_PASSWORD_MISSING_OR_INVALID');
  if (!env.STAGING_DB_CA_FILE || !isAbsolute(env.STAGING_DB_CA_FILE)) throw new Error('CA_PATH_INVALID');
  if (!/^[a-f0-9]{64}$/.test(env.STAGING_DB_CA_SHA256 ?? '') || sha256(caBytes) !== env.STAGING_DB_CA_SHA256 || !caBytes.toString().includes('-----BEGIN CERTIFICATE-----')) throw new Error('CA_BINDING_INVALID');
  const target = TARGETS[transport];
  const url = new URL(`postgresql://${target.host}:5432/postgres`);
  url.username = target.user;
  // URL's password setter preserves literal percent signs; encode first so a
  // provider password containing '%' cannot become an invalid URI escape.
  url.password = encodeURIComponent(password);
  url.searchParams.set('schema', 'public');
  url.searchParams.set('sslmode', 'require');
  url.searchParams.set('sslaccept', 'strict');
  url.searchParams.set('sslcert', env.STAGING_DB_CA_FILE);
  url.searchParams.set('connect_timeout', '10');
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('options', '-c statement_timeout=60000 -c lock_timeout=2000');
  return { url: url.href, transport, host: target.host };
}

export function childEnvironment(env, connectionUrl) {
  const child = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
    if (env[name]) child[name] = env[name];
  }
  return { ...child, DATABASE_URL: connectionUrl, DIRECT_URL: connectionUrl, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', NO_COLOR: '1' };
}
