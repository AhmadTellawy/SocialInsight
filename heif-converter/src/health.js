import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

function probeCommand(command, args, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, env: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
    const chunks = [];
    let length = 0;
    const collect = (chunk) => {
      length += chunk.length;
      if (length <= 4096) chunks.push(chunk);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && length <= 4096) resolve(Buffer.concat(chunks).toString('utf8').trim());
      else reject(new Error('Native version probe failed'));
    });
  });
}

export async function loadHealthEvidence(config, dependencies = {}) {
  const read = dependencies.readFile ?? readFile;
  const probe = dependencies.probeCommand ?? probeCommand;
  const sharpVersions = dependencies.sharpVersions ?? (await import('sharp')).default.versions;
  const manifest = JSON.parse(await read(config.versionManifestPath, 'utf8'));
  const converterBinary = await read(config.converterPath);
  const converterSha256 = createHash('sha256').update(converterBinary).digest('hex');
  const runtime = await probe(config.converterPath, ['--version']);
  const verified = manifest.libheif === '1.23.3'
    && manifest.libde265 === '1.1.1'
    && sharpVersions.sharp === '0.35.4'
    && runtime.includes('1.23.3')
    && converterSha256 === manifest.heifConvertSha256;
  if (!verified) throw new Error('Native or Sharp runtime version does not match the approved build');
  return Object.freeze({
    status: 'ready',
    service: 'heif-converter',
    versions: Object.freeze({
      node: process.versions.node,
      sharp: sharpVersions.sharp,
      libvips: sharpVersions.vips,
      libheif: manifest.libheif,
      libde265: manifest.libde265,
    }),
    nativeBuild: Object.freeze({
      libheifRef: manifest.libheifRef,
      libde265Ref: manifest.libde265Ref,
      libheifCommit: manifest.libheifCommit,
      libde265Commit: manifest.libde265Commit,
      heifConvertSha256: manifest.heifConvertSha256,
    }),
  });
}
