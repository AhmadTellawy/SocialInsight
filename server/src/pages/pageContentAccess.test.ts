import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import express from 'express';
import '../middleware/requestContext';

process.env.JWT_SECRET ||= 'page-content-access-isolated-test';
process.env.PAGES_ENABLED = 'true';

const prisma = require('../prisma').default as typeof import('../prisma').default;
const pageRoutes = require('./pageRoutes').default as typeof import('./pageRoutes').default;

test('public Page visibility never grants an unauthenticated management access receipt', async () => {
  const id = randomUUID();
  const original = prisma.post.findMany, originalTransaction = prisma.$transaction;
  (prisma.post as any).findMany = async () => [{ id }];
  (prisma as any).$transaction = async (action: any) => action({
    post: prisma.post,
    $executeRaw: async () => 1,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/pages', pageRoutes);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const request = async (management: boolean) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/pages/content-access`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ id, management }] })
      });
      assert.equal(response.status, 200);
      return response.json() as Promise<{ allowed: string[] }>;
    };
    assert.deepEqual((await request(true)).allowed, []);
    assert.deepEqual((await request(false)).allowed, [`${id}:public`]);
  } finally {
    (prisma.post as any).findMany = original;
    (prisma as any).$transaction = originalTransaction;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
