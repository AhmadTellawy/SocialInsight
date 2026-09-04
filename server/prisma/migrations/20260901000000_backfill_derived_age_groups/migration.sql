-- Age group is a derived cache. Date of birth remains the canonical source.
-- This upsert is idempotent and never invents a DOB for users who lack one.

WITH derived_age_groups AS (
  SELECT
    "id" AS "user_id",
    CASE
      WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, "birthday"::date)) < 18 THEN 'Under 18'
      WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, "birthday"::date)) <= 24 THEN '18-24'
      WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, "birthday"::date)) <= 34 THEN '25-34'
      WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, "birthday"::date)) <= 44 THEN '35-44'
      WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, "birthday"::date)) <= 54 THEN '45-54'
      ELSE '55+'
    END AS "age_group"
  FROM "users"
  WHERE "birthday" IS NOT NULL
)
INSERT INTO "user_demographics" ("user_id", "age_group", "updated_at")
SELECT "user_id", "age_group", CURRENT_TIMESTAMP
FROM derived_age_groups
ON CONFLICT ("user_id") DO UPDATE
SET
  "age_group" = EXCLUDED."age_group",
  "updated_at" = CURRENT_TIMESTAMP
WHERE "user_demographics"."age_group" IS DISTINCT FROM EXCLUDED."age_group";
