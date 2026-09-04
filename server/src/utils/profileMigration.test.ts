import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('profile migration preserves date-only DOB and enforces cover/link database invariants', () => {
  const sql = readFileSync(resolve(
    __dirname,
    '../../prisma/migrations/20260831020000_profile_links_dob_cover/migration.sql'
  ), 'utf8');

  assert.match(sql, /ADD VALUE IF NOT EXISTS 'PROFILE_COVER'/);
  assert.match(sql, /ALTER COLUMN "birthday" TYPE DATE USING "birthday"::date/);
  assert.match(sql, /ALTER COLUMN "dob" TYPE DATE USING "dob"::date/);
  assert.match(sql, /profile_links_user_id_normalized_url_key/);
  assert.match(sql, /profile_links_user_id_sort_order_key/);
  assert.match(sql, /"sort_order" BETWEEN 0 AND 4/);
  assert.match(sql, /"purpose" = 'PROFILE_COVER'[\s\S]*abs\("aspectRatio" - 3\.0\)/);
  assert.match(sql, /"purpose" <> 'PROFILE_COVER'[\s\S]*BETWEEN 0\.8 AND 1\.91/);
  assert.match(sql, /ON DELETE CASCADE/);
  assert.match(sql, /users_cover_media_id_fkey/);
});

test('profile cover enum is committed in a pre-migration without changing the failed migration checksum', () => {
  const preMigrationName = '20260831015000_add_profile_cover_enum';
  const failedMigrationName = '20260831020000_profile_links_dob_cover';
  assert.ok(preMigrationName < failedMigrationName, 'enum pre-migration must sort before the failed migration');

  const prelude = readFileSync(resolve(
    __dirname,
    `../../prisma/migrations/${preMigrationName}/migration.sql`
  ), 'utf8');
  const failed = readFileSync(resolve(
    __dirname,
    `../../prisma/migrations/${failedMigrationName}/migration.sql`
  ), 'utf8').replace(/\r\n/g, '\n');

  assert.match(prelude, /ALTER TYPE "MediaPurpose" ADD VALUE IF NOT EXISTS 'PROFILE_COVER'/);
  assert.doesNotMatch(prelude, /CHECK|CREATE TABLE|ALTER TABLE/);
  assert.equal(
    createHash('sha256').update(failed).digest('hex'),
    '649cfcf4061330ae5892e14d2061760d22cc04ffcb7ea73006572b21f82ead81',
    'the recorded failed migration must stay byte-for-byte equivalent'
  );
});

test('age-group backfill is DOB-derived, idempotent, and never invents a DOB', () => {
  const sql = readFileSync(resolve(
    __dirname,
    '../../prisma/migrations/20260901000000_backfill_derived_age_groups/migration.sql'
  ), 'utf8');

  assert.match(sql, /FROM "users"[\s\S]*WHERE "birthday" IS NOT NULL/);
  assert.match(sql, /EXTRACT\(YEAR FROM age\(\(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)::date, "birthday"::date\)\)/);
  assert.match(sql, /ON CONFLICT \("user_id"\) DO UPDATE/);
  assert.match(sql, /IS DISTINCT FROM EXCLUDED\."age_group"/);
  assert.doesNotMatch(sql, /UPDATE\s+"users"/i);
});

test('age-group cache refresh is scheduled daily and uses an atomic set-based upsert', () => {
  const source = readFileSync(resolve(__dirname, '../services/cronService.ts'), 'utf8');
  assert.match(source, /cron\.schedule\('0 0 \* \* \*'/);
  assert.doesNotMatch(source, /cron\.schedule\('0 0 1 \* \*'/);
  assert.match(source, /prisma\.\$executeRaw`[\s\S]*ON CONFLICT \("user_id"\) DO UPDATE/);
  assert.match(source, /WHERE "birthday" IS NOT NULL/);
});

test('health endpoint fails closed when Prisma has an unfinished migration', () => {
  const source = readFileSync(resolve(__dirname, '../app.ts'), 'utf8');
  assert.match(source, /FROM "_prisma_migrations"/);
  assert.match(source, /"finished_at" IS NULL[\s\S]*"rolled_back_at" IS NULL/);
  assert.match(source, /failedMigrations > 0[\s\S]*status\(503\)/);
  assert.match(source, /migrations: 'failed'/);
});
