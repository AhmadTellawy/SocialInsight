import { dirname } from 'node:path';
import { artifactKey, assertOutsideGit, captureSnapshot, CaptureReceipt, canonical, openOperatorDatabase, parseArguments, readProtected, requiredArgument, sanitizedFailure, sha256, validateReceipt, writeProtectedNew } from '../services/restoreReconciliationService';

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArguments(argv, ['receipt', 'receipt-sha256', 'output']);
  const receiptDigest = requiredArgument(args, 'receipt-sha256');
  const receipt = validateReceipt(readProtected(requiredArgument(args, 'receipt'), 65536), receiptDigest, 'CAPTURE') as CaptureReceipt;
  const output = assertOutsideGit(requiredArgument(args, 'output'), true);
  if (sha256(dirname(output)) !== receipt.protectedStore.locationSha256) throw new Error('PROTECTED_STORE_MISMATCH');
  const key = artifactKey(process.env);
  const db = openOperatorDatabase(receipt, process.env);
  try {
    const snapshot = await captureSnapshot(db, receipt, receiptDigest);
    validateReceipt(readProtected(requiredArgument(args, 'receipt'), 65536), receiptDigest, 'CAPTURE');
    writeProtectedNew(output, snapshot, key);
    console.log(JSON.stringify({ status: 'CAPTURED_ENCRYPTED', sha256: sha256(canonical(snapshot)), counts: snapshot.counts, finalSourceCutoff: snapshot.coverage.finalSourceCutoff }));
  } finally { key.fill(0); await db.$disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({ status: 'BLOCKED', code: sanitizedFailure(error) })); process.exitCode = 1; });
