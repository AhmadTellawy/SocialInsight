import { mkdir } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { HeifConverter } from './converter.js';
import { loadHealthEvidence } from './health.js';
import { createConverterServer } from './server.js';

const config = loadConfig();
await mkdir(config.tempRoot, { recursive: true, mode: 0o700 });
const healthEvidence = await loadHealthEvidence(config);
const converter = new HeifConverter(config);
const server = createConverterServer({ config, converter, healthEvidence });

server.listen(config.port, config.host, () => {
  console.info(JSON.stringify({ event: 'heif_converter_started', port: config.port }));
});

const shutdown = (signal) => {
  console.info(JSON.stringify({ event: 'heif_converter_stopping', signal }));
  server.close((error) => {
    process.exitCode = error ? 1 : 0;
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
