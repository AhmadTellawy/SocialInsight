import { PrismaClient } from '@prisma/client';
import { applyPageDatabaseContext, currentPageDatabaseContext, runWithPageTransaction } from './pages/pageDatabaseContext';

const base = new PrismaClient();

// Page operations run inside pageTransaction, which records its transaction in
// AsyncLocalStorage. Existing services keep importing this singleton, while
// nested calls are pinned to the same PostgreSQL transaction and its SET LOCAL
// RLS context instead of escaping onto another pooled connection.
const prisma = new Proxy(base, {
  get(target, property, receiver) {
    const context = currentPageDatabaseContext();
    const transaction = context?.transaction as any;
    if (transaction && property !== '$connect' && property !== '$disconnect' && property !== '$on') {
      const value = transaction[property as keyof typeof transaction];
      return typeof value === 'function' ? value.bind(transaction) : value;
    }
    if (property === '$transaction' && context) {
      return (input: any, options?: any) => {
        if (typeof input !== 'function') return (target.$transaction as any)(input, options);
        return (target.$transaction as any)(async (tx: any) => {
          await applyPageDatabaseContext(tx);
          return runWithPageTransaction(tx, () => input(tx));
        }, options);
      };
    }
    const value = Reflect.get(target, property, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
}) as PrismaClient;

export async function verifyPagesRuntimeDatabaseRole(): Promise<void> {
  if (process.env.NODE_ENV !== 'production' || process.env.PAGES_ENABLED !== 'true') return;
  const [role] = await base.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean; ownsPages: bigint }>>`
    SELECT r.rolsuper, r.rolbypassrls,
      (SELECT count(*) FROM pg_class c WHERE c.relowner = r.oid
        AND c.relname IN ('Page','PageMembership','PageHandle','PageInvitation','PageOwnershipTransfer',
          'PageFollow','PageBlock','PageAuditEvent','PageCase','PageEvent','PagePurgeJob'))::bigint AS "ownsPages"
    FROM pg_roles r WHERE r.rolname = current_user`;
  if (!role || role.rolsuper || role.rolbypassrls || Number(role.ownsPages) !== 0) {
    throw new Error('PAGES_RUNTIME_DATABASE_ROLE_UNSAFE');
  }
}

export default prisma;
