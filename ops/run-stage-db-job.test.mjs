import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dependencyEnvironment } from './run-stage-db-job.mjs';

test('dependency subprocess cannot inherit provider secrets or Node/npm hooks', () => {
  const sentinel = 'synthetic-private-provider-sentinel';
  const polluted = { ...process.env, STAGING_DB_ADMIN_PASSWORD: sentinel, DATABASE_URL: sentinel,
    DIRECT_URL: sentinel, SUPABASE_ACCESS_TOKEN: sentinel, JWT_SECRET: sentinel,
    NODE_OPTIONS: '--invalid-hook', npm_config_registry: sentinel, NPM_TOKEN: sentinel,
    STAGING_EXECUTION_RUN_ID: sentinel, RENDER_SERVICE_ID: sentinel };
  const clean = dependencyEnvironment(polluted);
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], {
    env: clean, encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.includes(sentinel), false);
  const observed = JSON.parse(child.stdout);
  for (const key of ['STAGING_DB_ADMIN_PASSWORD','DATABASE_URL','DIRECT_URL','SUPABASE_ACCESS_TOKEN','JWT_SECRET','NODE_OPTIONS','npm_config_registry','NPM_TOKEN','STAGING_EXECUTION_RUN_ID','RENDER_SERVICE_ID']) assert.equal(observed[key], undefined, key);
  assert.equal(observed.CI, 'true');
});
