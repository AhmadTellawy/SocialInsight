import prisma from '../prisma';
import { scheduleMediaDeletion } from './mediaService';

export async function resumeAccountCleanupJobs(): Promise<number> {
  const jobs = await prisma.accountCleanupJob.findMany({ where: { completedAt: null }, orderBy: { updatedAt: 'asc' }, take: 5 });
  for (const job of jobs) {
    try {
      await prisma.accountCleanupJob.update({ where: { id: job.id }, data: { attempts: { increment: 1 } } });
      await scheduleMediaDeletion(job.mediaIds);
      const remaining = await prisma.mediaAsset.count({ where: { id: { in: job.mediaIds }, status: { not: 'DELETED' } } });
      if (!remaining) await prisma.accountCleanupJob.update({ where: { id: job.id }, data: { completedAt: new Date(), mediaIds: [] } });
    } catch { console.error(JSON.stringify({ event: 'account_media_cleanup_retry_pending' })); }
  }
  return jobs.length;
}
