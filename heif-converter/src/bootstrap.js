import { mkdir } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { HeifConverter } from './converter.js';
import { loadHealthEvidence } from './health.js';
import { createConverterServer } from './server.js';
import { runStartupNativeProbe } from './startupNativeProbe.js';

export async function bootstrapConverterService(dependencies = {}) {
  const config = (dependencies.loadConfig ?? loadConfig)();
  const logger = dependencies.logger ?? console;
  await (dependencies.mkdir ?? mkdir)(config.tempRoot, { recursive: true, mode: 0o700 });
  const converter = dependencies.converter ?? new HeifConverter(config);
  const baseHealthEvidence = await (dependencies.loadHealthEvidence ?? loadHealthEvidence)(config);
  const nativeProbe = await (dependencies.runStartupNativeProbe ?? runStartupNativeProbe)(config, converter);
  const healthEvidence = Object.freeze({ ...baseHealthEvidence, nativeProbe });
  logger.info(JSON.stringify({
    event: 'heif_native_startup_probe_passed',
    fixtureSet: nativeProbe.fixtureSet,
    cases: nativeProbe.cases,
    elapsedMs: nativeProbe.elapsedMs,
    commit: process.env.RENDER_GIT_COMMIT ?? null,
    instance: process.env.RENDER_INSTANCE_ID ?? null,
  }));
  const server = (dependencies.createConverterServer ?? createConverterServer)({ config, converter, healthEvidence });
  server.listen(config.port, config.host, () => {
    logger.info(JSON.stringify({ event: 'heif_converter_started', port: config.port }));
  });
  return Object.freeze({ config, server, healthEvidence });
}
