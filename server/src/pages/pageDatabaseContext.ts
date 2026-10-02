import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';
import { isPageTestUser } from './pageFeature';

export type PageDatabaseContext = {
  actorId: string | null;
  staff: boolean;
  system: boolean;
  testUser: boolean;
  transaction?: Prisma.TransactionClient;
};

const storage = new AsyncLocalStorage<PageDatabaseContext>();

const configuredIds = (name: 'PAGES_STAFF_REVIEWERS' | 'PAGES_STAFF_OWNERSHIP'): Set<string> =>
  new Set((process.env[name] || '').split(',').map(value => value.trim()).filter(Boolean));

export const isConfiguredPageStaff = (actorId?: string | null): boolean => !!actorId &&
  (configuredIds('PAGES_STAFF_REVIEWERS').has(actorId) || configuredIds('PAGES_STAFF_OWNERSHIP').has(actorId));

export const currentPageDatabaseContext = (): PageDatabaseContext | undefined => storage.getStore();

export const runWithPageDatabaseContext = <T>(context: Omit<PageDatabaseContext, 'transaction'>,
  work: () => T): T => storage.run(context, work);

export const runWithPageTransaction = <T>(transaction: Prisma.TransactionClient, work: () => T): T => {
  const current = storage.getStore() || { actorId: null, staff: false, system: false, testUser: false };
  return storage.run({ ...current, transaction }, work);
};

export const pageRequestDatabaseContext = (actorId?: string | null): Omit<PageDatabaseContext, 'transaction'> => ({
  actorId: actorId || null,
  staff: isConfiguredPageStaff(actorId),
  system: false,
  testUser: isPageTestUser(actorId),
});

export const runWithPageSystemContext = <T>(work: () => T): T => storage.run({
  actorId: null,
  staff: false,
  system: true,
  testUser: false,
}, work);

export async function applyPageDatabaseContext(tx: Prisma.TransactionClient): Promise<void> {
  // Unit tests use deliberately narrow transaction doubles. Real Prisma
  // TransactionClient instances always provide $executeRaw.
  if (typeof (tx as any).$executeRaw !== 'function') return;
  const context = storage.getStore() || { actorId: null, staff: false, system: false, testUser: false };
  await tx.$executeRaw`SELECT set_config('socialinsight.user_id', ${context.actorId || ''}, true),
    set_config('socialinsight.page_staff', ${context.staff ? 'true' : 'false'}, true),
    set_config('socialinsight.page_system', ${context.system ? 'true' : 'false'}, true),
    set_config('socialinsight.page_test_user', ${context.testUser ? 'true' : 'false'}, true)`;
}
