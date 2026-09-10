// Every current and former handle occupies the same canonical namespace. The
// migration seeds existing users before these writers are enabled.
export class HandleError extends Error {
    constructor(public readonly code: string, public readonly status = 400) { super(code); }
}

const RESERVED_HANDLES = new Set([
    'admin', 'administrator', 'api', 'auth', 'billing', 'contact', 'help', 'login',
    'logout', 'me', 'moderator', 'notifications', 'official', 'opiniup', 'privacy',
    'profile', 'register', 'root', 'security', 'settings', 'socialinsight', 'staff',
    'support', 'system', 'terms', 'www'
]);

export const normalizeHandle = (value: unknown): string => {
    if (typeof value !== 'string') throw new HandleError('INVALID_HANDLE');
    const handle = value.trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,30}$/.test(handle)) throw new HandleError('INVALID_HANDLE');
    if (RESERVED_HANDLES.has(handle) || handle.startsWith('deleted_')) throw new HandleError('HANDLE_RESERVED');
    return handle;
};

// A single, short transaction lock also coordinates registration and OAuth.
// Using one namespace lock avoids cross-account rename deadlocks.
export const lockHandleNamespace = async (tx: any): Promise<void> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('account-handle-namespace'))`;
};

export const assertHandleAvailable = async (tx: any, handle: string, userId?: string): Promise<void> => {
    const claim = await tx.handleAlias.findUnique({ where: { handle }, select: { userId: true } });
    if (claim && (!userId || claim.userId !== userId)) throw new HandleError('HANDLE_UNAVAILABLE', 409);
    // Defense during rollout and against out-of-band legacy writers. Do not
    // assume that a missing namespace claim proves a name is unoccupied.
    const existing = await tx.user.findFirst({ where: { handle: { equals: handle, mode: 'insensitive' }, ...(userId ? { id: { not: userId } } : {}) }, select: { id: true } });
    if (existing) throw new HandleError('HANDLE_UNAVAILABLE', 409);
};

export const claimHandle = async (tx: any, handle: string, userId: string): Promise<void> => {
    const claim = await tx.handleAlias.findUnique({ where: { handle }, select: { userId: true } });
    if (claim) {
        if (claim.userId !== userId) throw new HandleError('HANDLE_UNAVAILABLE', 409);
        return;
    }
    await tx.handleAlias.create({ data: { handle, userId } });
};

// Call while holding the account lock. The surrounding versioned user update
// and these claims must commit or roll back together.
export const reserveRenamedHandle = async (tx: any, userId: string, oldHandle: string, nextHandle: string): Promise<void> => {
    await lockHandleNamespace(tx);
    await assertHandleAvailable(tx, nextHandle, userId);
    await claimHandle(tx, oldHandle.toLowerCase(), userId);
    await claimHandle(tx, nextHandle, userId);
};

export const resolveHandleUserId = async (db: any, value: unknown): Promise<string | null> => {
    if (typeof value !== 'string') return null;
    const handle = value.replace(/^@/, '').trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,30}$/.test(handle)) return null;
    const claim = await db.handleAlias.findUnique({ where: { handle }, select: { userId: true } });
    if (claim) return claim.userId; // A tombstone is never reassigned or resolved.
    return (await db.user.findFirst({ where: { handle: { equals: handle, mode: 'insensitive' } }, select: { id: true } }))?.id || null;
};
