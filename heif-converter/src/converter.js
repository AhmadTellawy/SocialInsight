import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ServiceError } from './errors.js';
import { runHeifConvert } from './processRunner.js';

const MAX_NATIVE_OUTPUT_BYTES = 128 * 1024 * 1024;
const MAX_WEBP_OUTPUT_BYTES = 12 * 1024 * 1024;

export class HeifConverter {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.runNative = dependencies.runNative ?? runHeifConvert;
    this.loadImageFactory = dependencies.imageFactory
      ? async () => dependencies.imageFactory
      : async () => (await import('sharp')).default;
    this.fs = dependencies.fs ?? { mkdtemp, readFile, readdir, rm, stat, writeFile };
  }

  async convert(input) {
    const tempDir = await this.fs.mkdtemp(path.join(this.config.tempRoot, 'job-'));
    const inputPath = path.join(tempDir, 'input.heic');
    const decodedPath = path.join(tempDir, 'decoded.png');
    try {
      await this.fs.writeFile(inputPath, input, { flag: 'wx', mode: 0o600 });
      await this.runNative({
        prlimitPath: this.config.prlimitPath,
        converterPath: this.config.converterPath,
        inputPath,
        outputPath: decodedPath,
        tempDir,
        timeoutMs: this.config.conversionTimeoutMs,
      });

      const jobFiles = (await this.fs.readdir(tempDir)).sort();
      if (jobFiles.length !== 2 || jobFiles[0] !== 'decoded.png' || jobFiles[1] !== 'input.heic') {
        throw new ServiceError(422, 'HEIF_COLLECTION_NOT_ALLOWED', 'HEIF collections and multiple top-level images are not supported');
      }

      const decodedStat = await this.fs.stat(decodedPath).catch(() => undefined);
      if (!decodedStat?.isFile() || decodedStat.size <= 0 || decodedStat.size > MAX_NATIVE_OUTPUT_BYTES) {
        throw new ServiceError(422, 'INVALID_NATIVE_OUTPUT', 'Native decoder did not produce a bounded PNG file');
      }
      const decoded = await this.fs.readFile(decodedPath);
      const imageFactory = await this.loadImageFactory();
      const pipeline = imageFactory(decoded, {
        failOn: 'error',
        limitInputPixels: this.config.maxAggregatePixels,
        sequentialRead: true,
      });
      const { data, info } = await pipeline
        .rotate()
        .toColourspace('srgb')
        .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 92, alphaQuality: 100, smartSubsample: true, effort: 4 })
        .toBuffer({ resolveWithObject: true });

      const metadata = await imageFactory(data, {
        failOn: 'error',
        limitInputPixels: this.config.maxAggregatePixels,
      }).metadata();
      if (
        info.format !== 'webp'
        || metadata.format !== 'webp'
        || !metadata.width
        || !metadata.height
        || metadata.width > 2400
        || metadata.height > 2400
        || metadata.width * metadata.height > this.config.maxAggregatePixels
        || data.length > MAX_WEBP_OUTPUT_BYTES
      ) {
        throw new ServiceError(500, 'INVALID_ENCODED_OUTPUT', 'Encoded output failed verification');
      }
      return Object.freeze({ data, mime: 'image/webp', width: metadata.width, height: metadata.height });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(422, 'IMAGE_PROCESSING_FAILED', 'HEIF image processing failed', { cause: error });
    } finally {
      await this.fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
