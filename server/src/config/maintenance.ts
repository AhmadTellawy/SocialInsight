export function readRestoreMaintenance(env: NodeJS.ProcessEnv = process.env): boolean {
    const value = env.RESTORE_MAINTENANCE?.trim();
    if (!value || value === 'false') return false;
    if (value === 'true') return true;
    throw new Error('RESTORE_MAINTENANCE must be true or false');
}
