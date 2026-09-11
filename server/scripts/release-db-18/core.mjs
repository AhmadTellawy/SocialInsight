import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const APPLICATION = '9a8a3aeea6b614fbd58421d0fc1f1c01b36eb4ef';
export const OPS_BASE = '583cee66281aef4519d87d0d06af4616c30d9719';
export const PRISMA = '6.19.2';
export const HASH = /^[a-f0-9]{64}(?![\s\S])/;
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export class GuardError extends Error { constructor(code) { super(code); this.code = code; } }
export function must(condition, code) { if (!condition) throw new GuardError(code); }
export function readRegular(path, max = 8 * 1024 * 1024) {
  const stat = lstatSync(path);
  must(stat.isFile() && !stat.isSymbolicLink() && stat.size <= max, 'FILE_INVALID');
  return readFileSync(path);
}
export function below(root, path) {
  const result = resolve(root, path);
  const rel = relative(root, result);
  must(rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel), 'PATH_INVALID');
  return result;
}
export function sourceFiles(root = ROOT, prefix = '') {
  const files = [];
  for (const entry of readdirSync(resolve(root, prefix), { withFileTypes: true })) {
    if (!prefix && ['node_modules', 'evidence', 'release-binding.json'].includes(entry.name)) continue;
    must(!entry.isSymbolicLink(), 'SYMLINK_FORBIDDEN');
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    must(!/(^|\/)\.env(?:\.|$)|prisma\.config\.[cm]?[jt]s$/.test(path), 'ENV_FILE_FORBIDDEN');
    if (entry.isDirectory()) files.push(...sourceFiles(root, path));
    else { must(entry.isFile(), 'FILE_INVALID'); files.push(path); }
  }
  return files.sort();
}
export function verifyBundle(root = ROOT) {
  const bytes = readRegular(resolve(root, 'release-binding.json'));
  const binding = JSON.parse(bytes);
  must(binding.schemaVersion === 1 && binding.application === APPLICATION && binding.opsBase === OPS_BASE && binding.prismaVersion === PRISMA, 'BINDING_INVALID');
  must(Array.isArray(binding.migrations) && binding.migrations.length === 18 && Array.isArray(binding.files), 'BINDING_INVALID');
  const actual = sourceFiles(root);
  must(JSON.stringify(actual) === JSON.stringify(binding.files.map(x => x.path).sort()), 'BUNDLE_FILE_SET_INVALID');
  for (const item of binding.files) {
    must(typeof item.path === 'string' && HASH.test(item.sha256), 'BINDING_INVALID');
    const file = readRegular(below(root, item.path));
    must(file.length === item.bytes && sha256(file) === item.sha256, 'BUNDLE_BYTES_INVALID');
  }
  must(new Set(binding.migrations.map(x => x.name)).size === 18, 'BINDING_INVALID');
  for (const item of binding.migrations) {
    must(/^\d{14}_[a-z_]+$/.test(item.name), 'BINDING_INVALID');
    must(binding.files.find(x => x.path === `prisma/migrations/${item.name}/migration.sql`)?.sha256 === item.checksum, 'BINDING_INVALID');
  }
  const migration10 = binding.migrations[9];
  const original = readRegular(resolve(root, `prisma/migrations/${migration10.name}/migration.sql`));
  const overlay = readRegular(resolve(root, 'overlays/PROD_10/migration10.sql'));
  must(sha256(original) === '5b89b5d2e1ad7464ca7fb98849c010c5bd8cc7ebdc826621c588f39c139910b4', 'BASELINE10_BYTES_INVALID');
  must(sha256(overlay) === '6c523622f3a261b11eacdd71a541fca178f0f757c36852f32325d7f486363f21', 'BASELINE10_BYTES_INVALID');
  must(original.equals(Buffer.from(overlay.toString('utf8').replaceAll('\r\n', '\n'))), 'BASELINE10_OVERLAY_INVALID');
  must(JSON.stringify(readdirSync(resolve(root, 'prisma/migrations')).sort()) === JSON.stringify([...binding.migrations.map(x => x.name), 'migration_lock.toml'].sort()), 'MIGRATION_SET_INVALID');
  return { ...binding, bindingSha256: sha256(bytes) };
}
export function utc(value) {
  must(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value, 'UTC_INVALID');
  return Date.parse(value);
}
export function sanitizedFailure(error) {
  return error instanceof GuardError && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'RELEASE18_FAILED';
}
export function realDirectory(path) {
  must(lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink(), 'DIRECTORY_INVALID');
  return realpathSync(path);
}
