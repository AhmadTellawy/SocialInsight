import { bootstrapConverterService } from './bootstrap.js';

const { server } = await bootstrapConverterService();

const shutdown = (signal) => {
  console.info(JSON.stringify({ event: 'heif_converter_stopping', signal }));
  server.close((error) => {
    process.exitCode = error ? 1 : 0;
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
