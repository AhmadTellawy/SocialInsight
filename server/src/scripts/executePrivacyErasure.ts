import { artifactKey, ErasureReceipt, executeErasure, openOperatorDatabase, parseArguments, protectedCheckpoints, readProtected, requiredArgument, sanitizedFailure, validateReceipt } from '../services/restoreReconciliationService';

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArguments(argv, ['receipt', 'receipt-sha256', 'checkpoints', 'apply']);
  const receipt = validateReceipt(readProtected(requiredArgument(args, 'receipt'), 65536), requiredArgument(args, 'receipt-sha256'), 'ACCOUNT_ERASE') as ErasureReceipt;
  const key = artifactKey(process.env);
  const checkpoint = protectedCheckpoints(requiredArgument(args, 'checkpoints'), key);
  const db = openOperatorDatabase(receipt, process.env);
  try {
    const result = await executeErasure(db, receipt, args.apply === true, checkpoint);
    console.log(JSON.stringify({ status: result.status, unresolvedGroups: 'unresolvedGroupIds' in result ? result.unresolvedGroupIds.length : 0 }));
    if (result.status === 'BLOCKED') process.exitCode = 2;
  } finally { key.fill(0); await db.$disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({ status: 'BLOCKED', code: sanitizedFailure(error) })); process.exitCode = 1; });
