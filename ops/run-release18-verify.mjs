// Credential-free Stage verification only. This entry point cannot migrate a database.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { must, sanitizedFailure, verifyBundle } from '../server/scripts/release-db-18/core.mjs';
import { assertCredentialFree, rejectInherited } from '../server/scripts/release-db-18/contract.mjs';
import { dependencyEnvironment, providerShellEnvironment } from './run-stage-db-job.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = resolve(HERE, '../server/scripts/release-db-18');
export const EXPECTED_BINDING = 'c74ce2ef9946377b793a723ea0efc6b4fbbd0210fc84d4882b47d54568b6271f';
export const STAGE_SERVICE = 'srv-dagsvgek1f9s73dqpg7g';

export function runRelease18Verify({ env = process.env, platform = process.platform, run = spawnSync, verify = verifyBundle, emit = console.log } = {}) {
  const source = providerShellEnvironment(env);
  must(platform === 'linux', 'PLATFORM_INVALID');
  // Check original names before constructing a sanitized child environment.
  rejectInherited(source);
  assertCredentialFree(source);
  must(source.RENDER_SERVICE_ID === STAGE_SERVICE, 'STAGE_SERVICE_INVALID');
  must(/^[a-f0-9]{40}$/.test(source.RENDER_GIT_COMMIT || ''), 'OPS_REVISION_INVALID');
  must(!source.STAGING_INITIAL_INSTALL_MODE || source.STAGING_INITIAL_INSTALL_MODE === 'verify', 'VERIFY_MODE_REQUIRED');
  const before = verify(PACKAGE);
  must(before.bindingSha256 === EXPECTED_BINDING, 'FROZEN_BINDING_MISMATCH');
  const clean = dependencyEnvironment(source);
  const invoke = (program, args, timeout, code) => {
    const result = run(program, args, { cwd: PACKAGE, env: clean, timeout, stdio: 'inherit', windowsHide: true });
    must(result && result.status === 0 && !result.error && !result.signal, code);
  };
  invoke('npm', ['ci'], 300000, 'DEPENDENCIES_FAILED');
  invoke(process.execPath, [resolve(PACKAGE, 'launch.mjs'), 'verify'], 60000, 'VERIFY_FAILED');
  invoke(process.execPath, [resolve(PACKAGE, 'tests/tls.mjs')], 210000, 'TLS_VERIFY_FAILED');
  must(verify(PACKAGE).bindingSha256 === EXPECTED_BINDING, 'FROZEN_BINDING_MISMATCH');
  const result = { status: 'PASSED', serviceId: STAGE_SERVICE, operationsCommit: source.RENDER_GIT_COMMIT,
    sourceBindingSha256: EXPECTED_BINDING, mode: 'CREDENTIAL_FREE_VERIFY', migrationsInPackage: 18,
    providerDatabaseConnections: 0, actualHostedTransportVerified: false, databaseMutation: false, applicationDeployment: false };
  emit(JSON.stringify(result));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    must(process.argv.length === 2, 'ARGUMENT_INVALID');
    const result = runRelease18Verify();
    const output = resolve(HERE, 'public-result');
    mkdirSync(output, { recursive: true });
    writeFileSync(resolve(output, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Stage package verification</title><h1>Credential-free package verification passed</h1><p>18 migrations verified. No database migration or application deployment performed.</p><pre>' + JSON.stringify(result, null, 2) + '</pre>\n');
  } catch (error) {
    console.error(JSON.stringify({ status: 'REJECTED', failureCode: sanitizedFailure(error), databaseMutation: false, applicationDeployment: false }));
    process.exitCode = 1;
  }
}
