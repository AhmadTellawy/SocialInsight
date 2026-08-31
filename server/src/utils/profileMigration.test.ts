import assert from 'node:assert/strict';
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
