import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { parsePort } from './port.js';

export function checkHealth(env = process.env, request = http.request) {
  // Validate synchronously, before creating a socket.
  const port = parsePort(env.PORT);
  if (env.HOST !== undefined) throw new Error('HOST overrides are not supported');
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const parts = [];
    const req = request({ hostname: '127.0.0.1', port, path: '/health/ready', method: 'GET', agent: false }, res => {
      if (res.statusCode !== 200) { res.destroy(); req.destroy(new Error('Health status')); return; }
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 16384) req.destroy(new Error('Health response too large'));
        else parts.push(chunk);
      });
      res.once('error', reject);
      res.once('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
          if (body.status !== 'ready' || body.confinement?.status !== 'passed'
            || body.confinement.schemaVersion !== 2 || body.confinement.policy !== 'rlimit-nproc-v2') throw new Error('Health contract');
          resolve();
        } catch (error) { reject(error); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('Health timeout')), 2000);
    req.once('close', () => clearTimeout(timer));
    req.once('error', reject);
    req.end();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Health arguments');
    await checkHealth();
  } catch { process.exitCode = 1; }
}
