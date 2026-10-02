import { PrismaClient } from '@prisma/client';
import { applyPageDatabaseContext, assertPageDatabaseContextSigningConfiguration, currentPageDatabaseContext,
  runWithPageSystemContext, runWithPageTransaction } from './pages/pageDatabaseContext';

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
  if (!pagesRuntimeRoleVerificationRequired()) return;
  const [role] = await base.$queryRaw<PagesRuntimeDatabaseRoleRecord[]>`
    SELECT r.rolsuper, r.rolbypassrls,
      pg_catalog.pg_has_role(current_user, 'socialinsight_runtime', 'MEMBER') AS "runtimeMember",
      pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') AS "canCreatePublic",
      pg_catalog.has_table_privilege(current_user, 'public._prisma_migrations',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS "canAccessMigrations",
      (SELECT count(*) FROM pg_catalog.pg_auth_members membership
        JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid
        WHERE membership.member = r.oid AND granted.rolname <> 'socialinsight_runtime')::bigint AS "unexpectedMemberships",
      (SELECT count(*) FROM pg_catalog.pg_class object
        JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace
        WHERE object.relowner = r.oid AND namespace.nspname = 'public')::bigint AS "ownedPublicObjects"
    FROM pg_roles r WHERE r.rolname = current_user`;
  assertPagesRuntimeDatabaseRoleRecord(role);
  assertPageDatabaseContextSigningConfiguration();
  await base.$transaction(async tx => runWithPageSystemContext(async () => {
    await applyPageDatabaseContext(tx);
    const [challenge] = await tx.$queryRaw<Array<{ valid: boolean }>>`
      SELECT public.socialinsight_context_is_system() AS valid`;
    if (challenge?.valid !== true) throw new Error('PAGES_RLS_CONTEXT_CHALLENGE_FAILED');
  }));
}

export type PagesRuntimeDatabaseRoleRecord = {
  rolsuper: boolean;
  rolbypassrls: boolean;
  runtimeMember: boolean;
  canCreatePublic: boolean;
  canAccessMigrations: boolean;
  unexpectedMemberships: bigint | number;
  ownedPublicObjects: bigint | number;
};

export const pagesRuntimeRoleVerificationRequired = (): boolean => process.env.NODE_ENV === 'production' && (
  process.env.PAGES_ENABLED === 'true' ||
  (process.env.PAGES_TEST_USERS || '').split(',').some(value => value.trim().length > 0)
);

export function assertPagesRuntimeDatabaseRoleRecord(role?: PagesRuntimeDatabaseRoleRecord): void {
  if (!role || role.rolsuper || role.rolbypassrls || !role.runtimeMember || role.canCreatePublic ||
    role.canAccessMigrations || Number(role.unexpectedMemberships) !== 0 || Number(role.ownedPublicObjects) !== 0) {
    throw new Error('PAGES_RUNTIME_DATABASE_ROLE_UNSAFE');
  }
}

export default prisma;
