import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const keyId = process.env.PAGES_RLS_CONTEXT_KEY_ID || '';
const encodedKey = process.env.PAGES_RLS_CONTEXT_SIGNING_KEY || '';
const directUrl = process.env.DIRECT_URL || '';

if (!directUrl) throw new Error('PAGES_RLS_DIRECT_URL_REQUIRED');
if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyId)) throw new Error('PAGES_RLS_CONTEXT_KEY_ID_INVALID');
if (!/^[0-9a-fA-F]{64,}$/.test(encodedKey) || encodedKey.length % 2 !== 0) {
  throw new Error('PAGES_RLS_CONTEXT_SIGNING_KEY_INVALID');
}

const prisma = new PrismaClient({ datasourceUrl: directUrl });

const main = async (): Promise<void> => {
  const key = Buffer.from(encodedKey, 'hex');
  await prisma.$executeRaw`
    INSERT INTO public.socialinsight_page_context_keys (kid, secret, active)
    VALUES (${keyId}, ${key}, true)
    ON CONFLICT (kid) DO UPDATE
      SET secret = EXCLUDED.secret, active = true, rotated_at = CURRENT_TIMESTAMP`;
  console.log('Pages RLS context key provisioned.');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Pages RLS context key provisioning failed.');
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
