import { loadConfig } from './config.js';
import { ConfinedHeifConverter } from './confinedService.js';
import { loadHealthEvidence } from './health.js';
import { createConverterServer } from './server.js';

const converter = new ConfinedHeifConverter({ onDiagnostic: code => console.info(JSON.stringify({ event: 'heif_worker_diagnostic', code })) });
let server;
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 4500);
  deadline.unref();
  const cleanup = converter.stop();
  server?.closeIdleConnections();
  await Promise.all([
    cleanup,
    server ? new Promise(resolve => server.close(resolve)) : Promise.resolve(),
  ]);
  clearTimeout(deadline);
  process.exitCode = 0;
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

try {
  const config = loadConfig();
  const { probe } = await converter.initialize();
  const healthEvidence = await loadHealthEvidence(config, { sharpVersions: probe.versions });
  if (!stopping && converter.isReady()) {
    server = createConverterServer({ config, converter, healthEvidence });
    server.listen(config.port, config.host, () => {
      console.info(JSON.stringify({ event: 'heif_converter_started', protocolVersion: 2 }));
    });
  }
} catch {
  await converter.stop();
  console.error(JSON.stringify({ event: 'heif_converter_startup_failed', code: 'CONFINEMENT_UNAVAILABLE' }));
  process.exitCode = 1;
}
