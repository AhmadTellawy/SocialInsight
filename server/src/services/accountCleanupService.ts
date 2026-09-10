import prisma from '../prisma';
import { scheduleMediaDeletion } from './mediaService';
import { lockAccountSecurity } from './mfaService';

export async function resumeAccountCleanupJobs(): Promise<number> {
  const jobs = await prisma.accountCleanupJob.findMany({ where: { completedAt: null }, orderBy: { updatedAt: 'asc' }, take: 5 });
  for (const job of jobs) {
    try {
      await prisma.accountCleanupJob.update({ where: { id: job.id }, data: { attempts: { increment: 1 } } });
      await scheduleMediaDeletion(job.mediaIds);
      await prisma.$transaction(async tx => {
        // A reconciliation replay can extend the job while storage is running.
        // Only clear the current complete list under the erasure account lock.
        await lockAccountSecurity(tx, job.userId);
        const current = await tx.accountCleanupJob.findUnique({ where: { id: job.id } });
        if (!current || current.completedAt) return;
        const remaining = await tx.mediaAsset.count({ where: { id: { in: current.mediaIds }, status: { not: 'DELETED' } } });
        if (!remaining) await tx.accountCleanupJob.update({ where: { id: current.id }, data: { completedAt: new Date(), mediaIds: [] } });
      });
    } catch { console.error(JSON.stringify({ event: 'account_media_cleanup_retry_pending' })); }
  }
  return jobs.length;
}
