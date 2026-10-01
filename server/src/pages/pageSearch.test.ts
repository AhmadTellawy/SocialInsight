import test from 'node:test';
import assert from 'node:assert/strict';
import { searchPageDirectory } from './pageSearch';

test('old exact handle occupies one first-page slot and never repeats on later cursors', async () => {
  const pages = Array.from({ length: 5 }, (_, index) => ({
    id: `page-${index}`, handle: index === 4 ? 'exact' : `fuzzy_${index}`,
    name: `Page ${index}`, createdAt: new Date(2026, 0, 5 - index), _count: { follows: 0 }
  }));
  const client: any = { page: {
    findFirst: async ({ where }: any) => pages.find(page => page.handle === where.handle) || null,
    findMany: async ({ where, cursor, skip, take }: any) => {
      let rows = pages.filter(page => page.id !== where.id?.not);
      if (cursor) rows = rows.slice(rows.findIndex(page => page.id === cursor.id) + (skip || 0));
      return rows.slice(0, take);
    }
  } };
  const all: string[] = [];
  let cursor: string | null = null;
  for (let pageNo = 0; pageNo < 4; pageNo++) {
    const result = await searchPageDirectory({}, 'exact', 2, cursor ? { cursor: { id: cursor }, skip: 1 } : {}, client);
    assert.ok(result.items.length <= 2);
    if (!pageNo) assert.equal(result.items[0].handle, 'exact');
    all.push(...result.items.map(item => item.id));
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  assert.deepEqual(new Set(all).size, 5);
  assert.equal(all.filter(id => id === 'page-4').length, 1);
  const single = await searchPageDirectory({}, 'exact', 1, {}, client);
  assert.deepEqual(single.items.map(item => item.id), ['page-0']);
});
