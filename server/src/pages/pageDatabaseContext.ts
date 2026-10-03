import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { isPageTestUser } from './pageFeature';

export type PageDatabaseContext = {
  actorId: string | null;
  staff: boolean;
  system: boolean;
  testUser: boolean;
  requestId?: string;
  transaction?: Prisma.TransactionClient;
};

const storage = new AsyncLocalStorage<PageDatabaseContext>();
const coordination = new WeakMap<object, { acquiredAt: bigint; lockCount: number; exclusiveCount: number }>();

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

export const pageRequestDatabaseContext = (actorId?: string | null, requestId?: string): Omit<PageDatabaseContext, 'transaction'> => ({
  actorId: actorId || null,
  staff: isConfiguredPageStaff(actorId),
  system: false,
  testUser: isPageTestUser(actorId),
  ...(requestId ? { requestId } : {}),
});

export const pagePerfEvent = (event: string, values: Record<string, unknown>): void => {
  if (process.env.PAGES_PERF_TELEMETRY !== 'true') return;
  const requestId = storage.getStore()?.requestId;
  console.info(JSON.stringify({ event, atMs: Date.now(), ...(requestId ? { requestId } : {}), ...values }));
};

export const markPageCoordinationAcquired = (transaction: object, lockCount: number,
  exclusiveCount: number): void => {
  const current = coordination.get(transaction);
  if (current) {
    current.lockCount = Math.max(current.lockCount, lockCount);
    current.exclusiveCount = Math.max(current.exclusiveCount, exclusiveCount);
    return;
  }
  coordination.set(transaction, { acquiredAt: process.hrtime.bigint(), lockCount, exclusiveCount });
};

export const pageCoordinationSnapshot = (transaction: object) => coordination.get(transaction);

export const runWithPageSystemContext = <T>(work: () => T): T => storage.run({
  actorId: null,
  staff: false,
  system: true,
  testUser: false,
}, work);

const contextKeyId = (): string => {
  const keyId = process.env.PAGES_RLS_CONTEXT_KEY_ID || '';
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyId)) throw new Error('PAGES_RLS_CONTEXT_KEY_ID_INVALID');
  return keyId;
};

const contextSigningKey = (): Buffer => {
  const encoded = process.env.PAGES_RLS_CONTEXT_SIGNING_KEY || '';
  if (!/^[0-9a-fA-F]{64,}$/.test(encoded) || encoded.length % 2 !== 0) {
    throw new Error('PAGES_RLS_CONTEXT_SIGNING_KEY_INVALID');
  }
  return Buffer.from(encoded, 'hex');
};

export function assertPageDatabaseContextSigningConfiguration(): void {
  contextKeyId();
  contextSigningKey();
}

export function signPageDatabaseContext(context: Omit<PageDatabaseContext, 'transaction'>,
  binding: { backendPid: string; transactionId: string }, now = new Date()): string {
  if (context.actorId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(context.actorId)) {
    throw new Error('PAGES_RLS_CONTEXT_ACTOR_INVALID');
  }
  if ((context.staff || context.testUser) && !context.actorId || context.system &&
      (context.actorId !== null || context.staff || context.testUser)) {
    throw new Error('PAGES_RLS_CONTEXT_SCOPE_INVALID');
  }
  const issuedAt = Math.floor(now.getTime() / 1000);
  const fields = [
    'v1', contextKeyId(), context.actorId || '0', context.staff ? '1' : '0', context.system ? '1' : '0',
    context.testUser ? '1' : '0', String(issuedAt), String(issuedAt + 30), binding.backendPid,
    binding.transactionId, randomBytes(16).toString('hex'),
  ];
  const unsigned = fields.join('.');
  return `${unsigned}.${createHmac('sha256', contextSigningKey()).update(unsigned, 'utf8').digest('hex')}`;
}

export async function applyPageDatabaseContext(tx: Prisma.TransactionClient): Promise<void> {
  // Unit tests use deliberately narrow transaction doubles. Real Prisma
  // TransactionClient instances always provide $executeRaw.
  if (typeof (tx as any).$executeRaw !== 'function' || typeof (tx as any).$queryRaw !== 'function') return;
  const context = storage.getStore() || { actorId: null, staff: false, system: false, testUser: false };
  const bindingStarted = process.hrtime.bigint();
  const [binding] = await tx.$queryRaw<Array<{ backendPid: string; transactionId: string }>>`
    SELECT pg_backend_pid()::text AS "backendPid", txid_current()::text AS "transactionId"`;
  if (!binding) throw new Error('PAGES_RLS_CONTEXT_BINDING_UNAVAILABLE');
  const bindingMs = Number(process.hrtime.bigint() - bindingStarted) / 1_000_000;
  const signedContext = signPageDatabaseContext(context, binding);
  const setStarted = process.hrtime.bigint();
  await tx.$executeRaw`SELECT set_config('socialinsight.page_context', ${signedContext}, true)`;
  const setConfigMs = Number(process.hrtime.bigint() - setStarted) / 1_000_000;
  pagePerfEvent('pages_rls_context', {
    bindingMs: Math.round(bindingMs * 100) / 100,
    setConfigMs: Math.round(setConfigMs * 100) / 100,
  });
}
