/// <reference path="../middleware/authMiddleware.ts" />

import assert from 'node:assert/strict';
import test from 'node:test';

const prisma = require('../prisma').default as typeof import('../prisma').default;
const { getMyProfileLinks } = require('./profileLinkController') as typeof import('./profileLinkController');

test('authenticated profile-link reads are private, uncached, and vary by authorization', async () => {
  const originalFindMany = prisma.profileLink.findMany;
  const headers: Record<string, string> = {};
  let varyHeader = '';
  let body: unknown;
  try {
    (prisma.profileLink as any).findMany = async ({ where }: any) => {
      assert.deepEqual(where, { userId: 'owner-1' });
      return [];
    };
    const response: any = {
      setHeader(name: string, value: string) { headers[name] = value; },
      vary(value: string) { varyHeader = value; return response; },
      json(value: unknown) { body = value; return response; },
      status() { return response; }
    };

    await getMyProfileLinks({ user: { userId: 'owner-1' } } as any, response);

    assert.equal(headers['Cache-Control'], 'private, no-store');
    assert.equal(varyHeader, 'Authorization');
    assert.deepEqual(body, []);
  } finally {
    (prisma.profileLink as any).findMany = originalFindMany;
  }
});

test('unexpected profile-link failures expose a correlation ID without logging internal details', async () => {
  const originalFindMany = prisma.profileLink.findMany;
  const originalConsoleError = console.error;
  let statusCode = 200;
  let body: any;
  const logs: string[] = [];
  try {
    (prisma.profileLink as any).findMany = async () => {
      throw new Error('sensitive database detail');
    };
    console.error = (...values: unknown[]) => { logs.push(values.map(String).join(' ')); };
    const response: any = {
      setHeader() { return response; },
      vary() { return response; },
      status(value: number) { statusCode = value; return response; },
      json(value: unknown) { body = value; return response; }
    };

    await getMyProfileLinks({
      user: { userId: 'owner-1' },
      requestId: 'request-profile-links-test'
    } as any, response);

    assert.equal(statusCode, 500);
    assert.equal(body.requestId, 'request-profile-links-test');
    assert.equal(JSON.stringify(body).includes('sensitive database detail'), false);
    assert.equal(logs.some((entry) => entry.includes('request-profile-links-test')), true);
    assert.equal(logs.some((entry) => entry.includes('sensitive database detail')), false);
  } finally {
    console.error = originalConsoleError;
    (prisma.profileLink as any).findMany = originalFindMany;
  }
});
