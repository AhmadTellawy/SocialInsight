import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { notificationSettingsSchema, readNotificationSettings } from '../services/notificationPolicy';
import { AccountSecurityError, lockAccountSecurity } from '../services/mfaService';
import { assertActiveAccountSession } from '../services/accountSecurityPolicy';

export async function getNotificationSettings(req: Request, res: Response) {
  try {
    const record = await prisma.notificationSettings.findUnique({ where: { userId: req.user!.userId } });
    res.set('Cache-Control', 'private, no-store').json({ settings: readNotificationSettings(record?.settings), updatedAt: record?.updatedAt.toISOString() || null });
  } catch { res.status(503).json({ code: 'SETTINGS_UNAVAILABLE', error: 'Settings could not be loaded' }); }
}

export async function updateNotificationSettings(req: Request, res: Response) {
  const parsed = notificationSettingsSchema.safeParse(req.body?.settings);
  const expected = req.body?.expectedUpdatedAt;
  if (!parsed.success || !(expected === null || typeof expected === 'string' && !Number.isNaN(Date.parse(expected)))) {
    res.status(400).json({ code: 'SETTINGS_INVALID', error: 'Invalid settings or version' }); return;
  }
  try {
    const record = await prisma.$transaction(async tx => {
      await lockAccountSecurity(tx, req.user!.userId);
      await assertActiveAccountSession(tx, req, false);
      // Serialize initial creation and updates using the owning account row.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.user!.userId} FOR UPDATE`;
      const previous = await tx.notificationSettings.findUnique({ where: { userId: req.user!.userId } });
      if ((previous?.updatedAt.toISOString() || null) !== expected) throw new Error('CONFLICT');
      const now = new Date(Math.max(Date.now(), (previous?.updatedAt.getTime() || 0) + 1));
      return tx.notificationSettings.upsert({ where: { userId: req.user!.userId },
        create: { userId: req.user!.userId, settings: JSON.stringify(parsed.data), updatedAt: now },
        update: { settings: JSON.stringify(parsed.data), updatedAt: now } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.set('Cache-Control', 'private, no-store').json({ settings: parsed.data, updatedAt: record.updatedAt.toISOString() });
  } catch (error) {
    if (error instanceof AccountSecurityError) { res.status(error.status).json({code:error.code,error:'Sign in again to continue'}); return; }
    const conflict = error instanceof Error && error.message === 'CONFLICT' || (error as any)?.code === 'P2034';
    res.status(conflict ? 409 : 503).json({ code: conflict ? 'SETTINGS_CONFLICT' : 'SETTINGS_UNAVAILABLE', error: conflict ? 'Settings changed on another device. Reload before saving.' : 'Settings could not be saved' });
  }
}
