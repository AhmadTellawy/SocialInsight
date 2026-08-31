import assert from 'node:assert/strict';
import test from 'node:test';
import { ProfileValidationError } from '../utils/profileValidation';
import { createProfileLink, deleteProfileLink, updateProfileLink } from './profileLinkService';

const profileLinkRow = (input: any, index: number) => ({
  id: `link-${index}`,
  userId: input.userId,
  title: input.title,
  url: input.url,
  normalizedUrl: input.normalizedUrl,
  sortOrder: input.sortOrder,
  createdAt: new Date('2026-08-31T00:00:00.000Z'),
  updatedAt: new Date('2026-08-31T00:00:00.000Z')
});

test('serializes concurrent creates under the user row lock and never creates a sixth link', async () => {
  const rows: any[] = [];
  let lockCalls = 0;
  let transactionTail = Promise.resolve();
  const tx: any = {
    $queryRaw: async () => {
      lockCalls += 1;
      return [{ id: 'owner-1' }];
    },
    profileLink: {
      findMany: async () => rows.map(({ sortOrder }) => ({ sortOrder })).sort((a, b) => a.sortOrder - b.sortOrder),
      create: async ({ data }: any) => {
        const row = profileLinkRow(data, rows.length);
        rows.push(row);
        return row;
      }
    }
  };
  const client: any = {
    profileLink: tx.profileLink,
    $transaction: (callback: (transaction: any) => Promise<any>) => {
      const result = transactionTail.then(() => callback(tx));
      transactionTail = result.then(() => undefined, () => undefined);
      return result;
    }
  };

  const outcomes = await Promise.allSettled(Array.from({ length: 6 }, (_, index) =>
    createProfileLink('owner-1', { title: `Link ${index}`, url: `https://example.com/${index}` }, client)
  ));

  assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 5);
  const rejected = outcomes.find(({ status }) => status === 'rejected') as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof ProfileValidationError);
  assert.equal(rejected.reason.code, 'PROFILE_LINK_LIMIT_REACHED');
  assert.deepEqual(rows.map(({ sortOrder }) => sortOrder), [0, 1, 2, 3, 4]);
  assert.equal(lockCalls, 6);
});

test('update and delete always scope mutations by link id and authenticated owner id', async () => {
  let updateWhere: any;
  let deleteWhere: any;
  const updateClient: any = {
    profileLink: {},
    $transaction: async (callback: (transaction: any) => Promise<any>) => callback({
      profileLink: {
        updateMany: async ({ where }: any) => {
          updateWhere = where;
          return { count: 0 };
        }
      }
    })
  };
  await assert.rejects(
    () => updateProfileLink('owner-a', 'link-owned-by-b', { title: 'Safe', url: 'example.com' }, updateClient),
    (error: any) => error?.code === 'PROFILE_LINK_NOT_FOUND'
  );
  assert.deepEqual(updateWhere, { id: 'link-owned-by-b', userId: 'owner-a' });

  const deleteClient: any = {
    $transaction: async () => undefined,
    profileLink: {
      deleteMany: async ({ where }: any) => {
        deleteWhere = where;
        return { count: 0 };
      }
    }
  };
  await assert.rejects(
    () => deleteProfileLink('owner-a', 'link-owned-by-b', deleteClient),
    (error: any) => error?.code === 'PROFILE_LINK_NOT_FOUND'
  );
  assert.deepEqual(deleteWhere, { id: 'link-owned-by-b', userId: 'owner-a' });
});

test('maps the per-user normalized URL unique constraint to a duplicate-link conflict', async () => {
  const client: any = {
    profileLink: {},
    $transaction: async (callback: (transaction: any) => Promise<any>) => callback({
      $queryRaw: async () => [{ id: 'owner-1' }],
      profileLink: {
        findMany: async () => [],
        create: async () => { throw { code: 'P2002' }; }
      }
    })
  };
  await assert.rejects(
    () => createProfileLink('owner-1', { title: 'Site', url: 'https://example.com/page#one' }, client),
    (error: any) => error?.code === 'DUPLICATE_PROFILE_LINK' && error?.statusCode === 409
  );
});
