import { bootstrapConverterService } from './bootstrap.js';

let runtime;
let stopping = false;
const shutdown = async (signal) => {
  if (stopping) return;
  stopping = true;
  console.info(JSON.stringify({ event: 'heif_converter_stopping', signal }));
  const deadline = setTimeout(() => process.exit(1), 4_500);
  deadline.unref();
  runtime?.server.closeIdleConnections();
  await Promise.all([
    runtime?.converter.stop() ?? Promise.resolve(),
    runtime?.server ? new Promise(resolve => runtime.server.close(resolve)) : Promise.resolve(),
  ]);
  clearTimeout(deadline);
  process.exitCode = 0;
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

try {
  runtime = await bootstrapConverterService();
} catch {
  console.error(JSON.stringify({ event: 'heif_converter_startup_failed', code: 'CONFINEMENT_UNAVAILABLE' }));
  process.exitCode = 1;
}
