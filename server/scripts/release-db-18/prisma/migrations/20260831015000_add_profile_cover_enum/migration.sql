-- PostgreSQL requires a newly-added enum value to be committed before a
-- later transaction may use it in constraints or persisted rows. Keep this
-- migration separate from 20260831020000_profile_links_dob_cover so the
-- existing, failed migration remains byte-for-byte unchanged and can be
-- retried safely after it is marked rolled back.

ALTER TYPE "MediaPurpose" ADD VALUE IF NOT EXISTS 'PROFILE_COVER';
