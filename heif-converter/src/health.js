import { readFile } from 'node:fs/promises';
import { runConfinedJob } from './confinedRunner.js';
import { createHash } from 'node:crypto';

async function probeCommand() {
  return runConfinedJob(Buffer.alloc(0), { nativeVersion: true, timeoutMs: 10000 });
}

export async function loadHealthEvidence(config, dependencies = {}) {
  const read = dependencies.readFile ?? readFile;
  const probe = dependencies.probeCommand ?? probeCommand;
  const sharpVersions = dependencies.sharpVersions;
  if (!sharpVersions || typeof sharpVersions.sharp !== 'string' || typeof sharpVersions.vips !== 'string') {
    throw new Error('Confined Sharp version evidence is required');
  }
  const manifest = JSON.parse(await read(config.versionManifestPath, 'utf8'));
  const converterBinary = await read(config.converterPath);
  const converterSha256 = createHash('sha256').update(converterBinary).digest('hex');
  const runtime = await probe(config.converterPath, ['--version']);
  const verified = manifest.libheif === '1.23.4'
    && manifest.libde265 === '1.1.1'
    && manifest.libheifRef === 'v1.23.4'
    && manifest.libde265Ref === 'v1.1.1'
    && manifest.libheifCommit === '4e14f5942c1732ace9611b9522cc991501445463'
    && manifest.libde265Commit === '4dd701fffac01632ffd5cabc5ef10deb56accba1'
    && sharpVersions.sharp === '0.35.4'
    && runtime.includes('1.23.4')
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
