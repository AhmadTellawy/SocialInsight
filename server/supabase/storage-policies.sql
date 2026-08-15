-- socialinsight uses custom application JWTs, not Supabase Auth JWTs.
-- All writes and private reads therefore flow through the trusted backend service role.
-- No anon/authenticated INSERT, UPDATE, DELETE, LIST, or private SELECT policy is created.
-- The media-public bucket is intentionally public for stable CDN delivery; its masters
-- remain in media-originals and restricted derivatives remain in media-private.

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
