import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { configureStaging } from './stagingConfig';

const configuration = (): NodeJS.ProcessEnv => ({
  DEPLOYMENT_ENV: 'staging', STAGING_DATABASE_PROJECT_REF: 'mnfiixtgnlzmduunfryt',
  DATABASE_URL: 'postgresql://otp_staging_app.mnfiixtgnlzmduunfryt:synthetic@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&sslaccept=strict',
  CLIENT_URL: 'https://social-insight-git-code-a8f10e-ahmad-husseins-projects-97b8d8be.vercel.app',
  RENDER_GIT_COMMIT: 'a'.repeat(40), STAGING_RELEASE_SHA: 'a'.repeat(40), RENDER_GIT_BRANCH: 'codex/otp-resend-production'
});

test('staging requires isolated DB identities, Preview origin and exact release SHA', () => {
  for (const patch of [
    { DATABASE_URL: 'postgresql://postgres:synthetic@db.jlanmsxfggpnbwoowejy.supabase.co:5432/postgres' },
    { DIRECT_URL: 'postgresql://postgres:synthetic@db.other-project.supabase.co:5432/postgres' },
    { CLIENT_URL: 'https://socialinsightapp.com' },
    { CLIENT_URL: 'https://opiniup.com' },
    { CLIENT_URL: 'https://www.opiniup.com' },
    { CLIENT_URL: 'https://other-project.vercel.app' },
    { STAGING_DATABASE_PROJECT_REF: 'abcdefghijklmnopqrst' },
    { RENDER_GIT_COMMIT: 'b'.repeat(40) }, { RENDER_GIT_BRANCH: 'main' },
    { STAGING_TRUST_PROXY_HOPS: 'true' }, { STAGING_TRUST_PROXY_HOPS: '6' },
    { DEPLOYMENT_ENV: 'stagign' }, { DEPLOYMENT_ENV: undefined },
    { DATABASE_URL: configuration().DATABASE_URL!.replace('otp_staging_app.', 'postgres.') },
    { DATABASE_URL: configuration().DATABASE_URL!.replace('sslmode=require', 'sslmode=disable') }
  ]) assert.throws(() => configureStaging(express(), { ...configuration(), ...patch }), /isolation/);
  const app = express();
  configureStaging(app, configuration());
  assert.equal(app.get('trust proxy'), 0);
  configureStaging(app, { ...configuration(), STAGING_TRUST_PROXY_HOPS: '1' });
  assert.equal(app.get('trust proxy'), 1);
});

test('Production defaults are untouched', () => {
  const app = express();
  configureStaging(app, { DEPLOYMENT_ENV: 'production', STAGING_TRUST_PROXY_HOPS: 'true' });
  assert.equal(app.get('trust proxy'), false);
});

test('numeric proxy trust ignores spoofed addresses beyond the trusted hop', async () => {
  const app = express();
  configureStaging(app, { ...configuration(), STAGING_TRUST_PROXY_HOPS: '1' });
  app.get('/', (req, res) => res.json({ ip: req.ip }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as { port: number };
    for (const spoofed of ['198.51.100.1', '203.0.113.2']) {
      const result = await fetch(`http://127.0.0.1:${address.port}`, { headers: { 'X-Forwarded-For': `${spoofed}, 192.0.2.1` } });
      assert.deepEqual(await result.json(), { ip: '192.0.2.1' });
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
