// Maintainer-only source preparation. This never reads environment files or connects to a database.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { APPLICATION, OPS_BASE, PRISMA, ROOT, must, readRegular, sha256, sourceFiles } from './core.mjs';

const repo = resolve(ROOT, '../../../..', 'account-settings');
function git(args) {
  const result = spawnSync('git', ['-c', `safe.directory=${repo.replaceAll('\\', '/')}`, '-C', repo, ...args], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  must(result.status === 0 && !result.error, 'SOURCE_GIT_FAILED');
  return result.stdout;
}
const paths = git(['ls-tree', '-r', '--name-only', APPLICATION, 'server/prisma/schema.prisma', 'server/prisma/migrations']).toString().trim().split('\n');
must(paths.length === 20, 'SOURCE_FILE_COUNT_INVALID');
for (const source of paths) {
  must(/^server\/prisma\/(?:schema\.prisma|migrations\/(?:migration_lock\.toml|\d{14}_[a-z_]+\/migration\.sql))$/.test(source), 'SOURCE_PATH_INVALID');
  const dest = resolve(ROOT, source.slice('server/'.length));
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, git(['show', `${APPLICATION}:${source}`]));
}
const migrations = paths.filter(x => x.endsWith('/migration.sql')).map(path => ({ name: path.split('/')[3], checksum: sha256(readRegular(resolve(ROOT, path.slice(7)))) })).sort((a,b) => a.name.localeCompare(b.name));
const tables = { '0': [] };
const seen = new Set();
for (let i=0;i<migrations.length;i++) {
  const sql=readRegular(resolve(ROOT,`prisma/migrations/${migrations[i].name}/migration.sql`)).toString();
  for (const match of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:"([A-Za-z_][A-Za-z0-9_]*)"|([a-z_][a-z0-9_]*))/g)) seen.add(match[1]??match[2]);
  if ([10,15,18].includes(i+1)) tables[String(i+1)]=[...seen].sort();
}
const original = readRegular(resolve(ROOT, `prisma/migrations/${migrations[9].name}/migration.sql`));
must(!original.includes(Buffer.from('\r')), 'SOURCE10_NOT_LF');
mkdirSync(resolve(ROOT, 'overlays/PROD_10'), { recursive: true });
writeFileSync(resolve(ROOT, 'overlays/PROD_10/migration10.sql'), original.toString().replaceAll('\n', '\r\n'));
const files = sourceFiles().map(path => { const bytes = readRegular(resolve(ROOT, path)); return { path, bytes: bytes.length, sha256: sha256(bytes) }; });
writeFileSync(resolve(ROOT, 'release-binding.json'), JSON.stringify({ schemaVersion: 1, application: APPLICATION, opsBase: OPS_BASE, prismaVersion: PRISMA, migrations, tables, files }, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PREPARED', application: APPLICATION, migrations: 18, files: files.length, hostedExecutionApproved: false }));
