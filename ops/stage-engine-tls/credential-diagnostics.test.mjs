import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCredentialFree, credentialDiagnosticNames } from './verify.mjs';
const namesFor = key => credentialDiagnosticNames({ [key]: 'synthetic-private-value' }).variableNames;

test('diagnostic projection accepts exact bounded ordinary and Bash export identifiers', () => {
  for (const name of ['TOKEN', '_TOKEN', 'TOKEN' + 'x'.repeat(59), 'BASH_FUNC_TOKEN%%', 'BASH_FUNC__token_probe%%', 'BASH_FUNC_TOKEN' + 'x'.repeat(59) + '%%']) {
    assert.deepEqual(namesFor(name), [name]);
    assert.throws(() => assertCredentialFree({ [name]: 'synthetic-private-value' }), /VERIFY_CREDENTIAL_CONFIGURATION_PRESENT/);
  }
});

test('diagnostic projection rejects invalid Bash wrappers and non-ASCII or control characters', () => {
  for (const name of [
    'BASH_FUNC_TOKEN%', 'BASH_FUNC_TOKEN%%%', 'BASH_FUNC_TOKEN%%tail', 'bash_func_TOKEN%%', 'XBASH_FUNC_TOKEN%%',
    'BASH_FUNC_1TOKEN%%', 'BASH_FUNC_TOKEN-probe%%', 'BASH_FUNC_TOKEN:probe%%', 'BASH_FUNC_TOKEN/probe%%', 'BASH_FUNC_TOKEN probe%%',
    'BASH_FUNC_TOKEN$probe%%', 'BASH_FUNC_TOKEN()%%', 'BASH_FUNC_TOKENé%%', 'BASH_FUNC_TOKEN\0%%',
    'TOKEN' + 'x'.repeat(60), 'BASH_FUNC_TOKEN' + 'x'.repeat(60) + '%%',
    ...['\n', '\r', '\r\n', '\u2028', '\u2029'].flatMap(end => ['TOKEN' + end, 'BASH_FUNC_TOKEN%%' + end])
  ]) {
    assert.deepEqual(namesFor(name), ['UNSAFE_VARIABLE_NAME'], JSON.stringify(name));
    assert.throws(() => assertCredentialFree({ [name]: 'synthetic-private-value' }), /VERIFY_CREDENTIAL_CONFIGURATION_PRESENT/);
  }
});

test('diagnostics and rejection inspect names without accessing getter-backed values', () => {
  const env = {};
  for (const name of ['BASH_FUNC_read_TOKEN%%', 'TOKEN', 'TOKEN\nprivate-sentinel']) Object.defineProperty(env, name, { enumerable: true, get: () => assert.fail('value accessed') });
  const result = credentialDiagnosticNames(env);
  assert.deepEqual(result.variableNames, ['BASH_FUNC_read_TOKEN%%', 'TOKEN', 'UNSAFE_VARIABLE_NAME']);
  assert.equal(JSON.stringify(result).includes('private-sentinel'), false);
  assert.throws(() => assertCredentialFree(env), /VERIFY_CREDENTIAL_CONFIGURATION_PRESENT/);
});

test('projection keeps its sorted 16-name bound and filters noncredential names', () => {
  const env = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`BASH_FUNC_TOKEN_${String(19 - i).padStart(2, '0')}%%`, 'synthetic-private-value']));
  env.BASH_FUNC_echo = 'synthetic-private-value'; env['BASH_FUNC_echo%%'] = 'synthetic-private-value';
  const result = credentialDiagnosticNames(env);
  assert.equal(result.variableNames.length, 16); assert.equal(result.variableNamesTruncated, true);
  assert.deepEqual(result.variableNames, Object.keys(env).filter(name => name.includes('TOKEN')).sort().slice(0, 16));
  assert.equal(JSON.stringify(result).includes('synthetic-private-value'), false);
});

test('credential rejection predicate remains identical to e941 for ordinary and wrapped names', () => {
  const baseline = key => /(PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|PRIVATE_KEY|ACCESS_KEY|DATABASE_URL|DIRECT_URL|(?:^|_)API_KEY(?:_|$))/i.test(key) || /^PG(?:USER|HOST|PORT|DATABASE|SERVICE|SSLKEY|SSLCERT|PASSFILE)/i.test(key);
  for (const inner of ['echo', 'PATH', 'PGUSER', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGSERVICE', 'PGSSLKEY', 'PGSSLCERT', 'PGPASSFILE', 'PASSWORD', 'PASSWD', 'SECRET', 'TOKEN', 'CREDENTIAL', 'PRIVATE_KEY', 'ACCESS_KEY', 'DATABASE_URL', 'DIRECT_URL', 'API_KEY']) {
    for (const name of [inner, `BASH_FUNC_${inner}%%`, `BASH_FUNC_${inner}%%%`, `${inner}\n`]) {
      let rejected = false;
      try { assertCredentialFree({ [name]: 'synthetic-private-value' }); } catch (error) { assert.equal(error.message, 'VERIFY_CREDENTIAL_CONFIGURATION_PRESENT'); rejected = true; }
      assert.equal(rejected, baseline(name), JSON.stringify(name));
    }
  }
});
