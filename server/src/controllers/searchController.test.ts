import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../prisma';
import { MAX_SEARCH_QUERY_LENGTH, parseSearchQuery, searchAll } from './searchController';

const response = () => {
  const state: { status: number; body?: unknown } = { status: 200 };
  const res: any = {
    status(code: number) { state.status = code; return res; },
    json(body: unknown) { state.body = body; return res; }
  };
  return { res, state };
};

test('search query accepts bounded Arabic text and normalizes whitespace', () => {
  assert.deepEqual(parseSearchQuery('  استطلاع الرأي  '), { kind: 'valid', query: 'استطلاع الرأي' });
});

test('search query rejects arrays, objects, null, and oversized text before database access', async () => {
  const invalid = [['one', 'two'], { nested: true }, null, 'x'.repeat(MAX_SEARCH_QUERY_LENGTH + 1)];
  for (const q of invalid) {
    const { res, state } = response();
    await searchAll({ query: { q } } as any, res);
    assert.equal(state.status, 400);
    assert.deepEqual(state.body, {
      error: 'Search query must be a single text value of at most 120 characters.',
      code: 'INVALID_SEARCH_QUERY'
    });
  }
});

test('missing and too-short search values remain an empty result', async () => {
  for (const q of [undefined, '', ' ع ']) {
    const { res, state } = response();
    await searchAll({ query: { q } } as any, res);
    assert.equal(state.status, 200);
    assert.deepEqual(state.body, { topics: [], surveys: [], people: [], groups: [], categories: [] });
  }
});

test('post text matching is ANDed with the complete audience predicate', async () => {
  let postWhere: any;
  const originals = {
    hashtagFindMany: (prisma.hashtag as any).findMany,
    postFindMany: prisma.post.findMany,
    userFindMany: prisma.user.findMany,
    groupFindMany: prisma.group.findMany
  };
  try {
    (prisma.hashtag as any).findMany = async () => [];
    (prisma.post as any).findMany = async ({ where }: any) => { postWhere = where; return []; };
    (prisma.user as any).findMany = async () => [];
    (prisma.group as any).findMany = async () => [];
    const { res, state } = response();
    await searchAll({ query: { q: 'private title' } } as any, res);
    assert.equal(state.status, 200);
    assert.equal(postWhere.AND.length, 2);
    assert.ok(Array.isArray(postWhere.AND[0].OR), 'the visibility union must remain intact');
    assert.ok(Array.isArray(postWhere.AND[1].OR), 'text alternatives must be a separate conjunct');
    assert.equal(postWhere.OR, undefined, 'text matching must never replace the visibility OR');
  } finally {
    (prisma.hashtag as any).findMany = originals.hashtagFindMany;
    (prisma.post as any).findMany = originals.postFindMany;
    (prisma.user as any).findMany = originals.userFindMany;
    (prisma.group as any).findMany = originals.groupFindMany;
  }
});
