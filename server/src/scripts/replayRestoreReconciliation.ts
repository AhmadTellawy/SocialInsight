import { artifactKey, decryptArtifact, openOperatorDatabase, parseArguments, protectedCheckpoints, readProtected, replaySnapshot, requiredArgument, RestoreReceipt, sanitizedFailure, validateReceipt, validateRestoreBinding, validateSnapshot } from '../services/restoreReconciliationService';

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArguments(argv, ['receipt', 'receipt-sha256', 'artifact', 'checkpoints', 'apply']);
  const receipt = validateReceipt(readProtected(requiredArgument(args, 'receipt'), 65536), requiredArgument(args, 'receipt-sha256'), 'RESTORE') as RestoreReceipt;
  const key = artifactKey(process.env);
  const snapshot = validateSnapshot(decryptArtifact(readProtected(requiredArgument(args, 'artifact')), key));
  validateRestoreBinding(snapshot, receipt, requiredArgument(args, 'artifact'));
  const checkpoint = protectedCheckpoints(requiredArgument(args, 'checkpoints'), key);
  const db = openOperatorDatabase(receipt, process.env);
  try {
    const apply = args.apply === true;
    // Check the storage endpoint independently from DB before creating a client.
    // Local synthetic runs inject a test adapter in service tests; this CLI never
    // sends synthetic deletions to a hosted bucket.
    let remove: (bucket: string, keys: string[], signal: AbortSignal) => Promise<void> = async () => { throw new Error('STORAGE_ADAPTER_REQUIRED'); };
    if (apply) {
      if (receipt.target.environment === 'LOCAL_SYNTHETIC') throw new Error('SYNTHETIC_CLI_STORAGE_DISABLED');
      if (process.env.SUPABASE_URL !== `https://${receipt.target.projectRef}.supabase.co` || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('STORAGE_TARGET_MISMATCH');
      const { createClient } = await import('@supabase/supabase-js');
      remove = async (bucket, keys, signal) => {
        const storage = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }) }
        });
        const { error } = await storage.storage.from(bucket).remove(keys);
        if (error) throw new Error('STORAGE_REMOVAL_FAILED');
      };
    }
    const result = await replaySnapshot(db, snapshot, receipt, apply, { remove, checkpoint });
    console.log(JSON.stringify({ ...result, unresolvedGroupIds: undefined, unresolvedGroups: result.unresolvedGroupIds.length }));
    if (result.status === 'BLOCKED') process.exitCode = 2;
  } finally { key.fill(0); await db.$disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({ status: 'BLOCKED', code: sanitizedFailure(error) })); process.exitCode = 1; });
