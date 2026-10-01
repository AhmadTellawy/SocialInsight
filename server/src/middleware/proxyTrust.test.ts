import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { configureProxyTrust } from './proxyTrust';

async function probe(render: string, forwarding: string[]): Promise<number[]> {
  const app = express();
  configureProxyTrust(app, render);
  app.use(rateLimit({ windowMs: 60_000, limit: 1, standardHeaders: false, legacyHeaders: false,
    validate: { xForwardedForHeader: render === 'true' } }));
  app.get('/', (_req, res) => res.sendStatus(200));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const statuses: number[] = [];
    for (const value of forwarding) {
      const response = await fetch(`http://127.0.0.1:${address.port}/`, { headers: { 'x-forwarded-for': value } });
      statuses.push(response.status);
      await response.arrayBuffer();
    }
    return statuses;
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('Render proxy keys separate clients, while spoofed earlier hops share the nearest client bucket', async () => {
  assert.deepEqual(await probe('true', [
    '203.0.113.1, 198.51.100.1',
    '203.0.113.2, 198.51.100.1',
    '203.0.113.3, 198.51.100.2',
  ]), [200, 429, 200]);
});

test('direct runtime ignores untrusted forwarding headers', async () => {
  assert.deepEqual(await probe('false', ['198.51.100.1', '198.51.100.2']), [200, 429]);
});
