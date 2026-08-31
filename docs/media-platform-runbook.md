# socialinsight Media Platform Runbook

## Scope

This runbook covers the additive media schema, Supabase Storage provisioning, backend/frontend rollout, legacy-media backfill, verification, and recovery. Legacy image columns remain in place during the compatibility period.

## Required Environment

Backend:

- `DATABASE_URL`
- `DIRECT_URL` when required by the production Prisma/Supabase setup
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLIENT_URL`
- Optional `MEDIA_BACKFILL_ALLOWED_HOSTS`: comma-separated exact HTTPS hostnames approved for legacy remote-image migration
- Optional `JSON_BODY_LIMIT`; defaults to `4mb` during legacy-client compatibility

Frontend:

- `VITE_API_URL`

Never expose the Supabase service-role key to Vite or any browser environment variable.

## Release Order

1. Confirm the production database backup/recovery point and deployment targets.
2. Confirm the backend Supabase variables are configured in the existing deployment environment.
3. Deploy the backend using its configured `render-build` command. It applies additive migrations and idempotently creates/verifies the three buckets before compilation.
4. Run `npm run media:provision` separately only when validating or repairing bucket configuration outside a normal deploy.
5. Verify `/api/health` and `/api/media/config` before deploying the frontend.
6. Deploy the frontend with the repository's Vercel integration.
7. Run the legacy backfill dry-run.
8. Run controlled backfill batches with `--apply`.
9. Verify every migrated domain online, confirm storage reads, privacy, and payload size, and take a fresh recovery point.
10. Run the legacy Base64 cleanup dry-run with exact expected counts and storage verification.
11. Apply cleanup only after its complete preflight succeeds, then verify zero remaining legacy Base64 fields.

Do not use `prisma db push --accept-data-loss` in production.

## Storage Provisioning

From `server/`:

```powershell
npm run media:provision
```

Expected buckets:

- `media-originals`: private masters and temporary uploads
- `media-private`: private/restricted display variants
- `media-public`: public display variants

Profile and group avatars are public display assets. Draft media is owner-only. Post, question, and option images inherit the authoritative post/group audience.

## Backfill

The command is dry-run unless `--apply` is present:

```powershell
npm run media:backfill -- --batch-size=25
```

Apply all supported Data URL records:

```powershell
npm run media:backfill -- --apply --batch-size=25
```

Limit a controlled production batch:

```powershell
npm run media:backfill -- --apply --domains=user --limit=100 --batch-size=20
```

Resume one domain after the last reported cursor:

```powershell
npm run media:backfill -- --apply --domains=post --after=<exact-cursor-id> --batch-size=20
```

Remote legacy URLs are skipped unless their exact hostname is in `MEDIA_BACKFILL_ALLOWED_HOSTS` or passed explicitly:

```powershell
npm run media:backfill -- --apply --allow-hosts=approved-cdn.example.com
```

The loader requires HTTPS, rejects credentials/nonstandard ports, resolves DNS, blocks private/link-local/reserved addresses, and revalidates every redirect. Never broadly allowlist a user-controlled hostname.

The backfill is idempotent because it selects records whose new media relation is still null. It preserves legacy column values and records only IDs, outcomes, source class, and access scope in logs. Failed exact assets are purged; unrelated records and objects are never deleted.

## Verification Gates

Before production:

```powershell
cd server
npm test
npm run build
cd ..
npm run build
```

Online verification must target only `https://socialinsightapp.com/`. Mutation tests must use the repository controlled-write gate, `e2e_` data, captured exact IDs, and exact-ID cleanup.

Verify:

- one, two, and eight post images; ninth rejected
- shared ratio remains stable after reorder
- touch swipe, desktop controls, keyboard controls, indicators, and stable carousel height
- avatar/group/question/option add, crop, replace, remove, and persistence
- public, private, followers, group, and draft access
- public-to-private and private-to-public transitions for existing posts
- no Base64 blobs in migrated feed/search/user responses
- no private signed URLs persisted in localStorage
- no browser requests to external avatar/fallback services
- temporary upload cleanup and replacement/deletion cleanup

## Legacy Base64 Cleanup

Run cleanup only after backfill and all verification gates above have passed. It is a separate maintenance command and is intentionally not part of `render-build`. The default mode is read-only:

```powershell
cd server
npm run media:cleanup-base64 -- --batch-size=25
```

Include an actual Supabase download and image metadata check in the dry-run:

```powershell
npm run media:cleanup-base64 -- --verify-storage --batch-size=25
```

For the currently audited production set, pin both the total and per-domain counts. Re-run the dry-run immediately before applying; if the counts have changed, stop and investigate rather than changing the expectation blindly:

```powershell
npm run media:cleanup-base64 -- --verify-storage --expect-total=38 --expect=user:5,group:0,post:8,question:8,option:17
```

Apply only from the configured production backend environment after a fresh recovery point:

```powershell
npm run media:cleanup-base64 -- --apply --batch-size=25 --expect-total=38 --expect=user:5,group:0,post:8,question:8,option:17
```

Supported controls are `--domains=user,group,post,question,option`, `--batch-size`, `--limit`, `--expect-total`, and `--expect`. `--limit` is useful for audits, but apply remains fail-closed: every remaining Base64 record in each selected domain must be scanned and eligible, so a partial limit cannot silently clear only part of a domain.

Eligibility requires an exact supported `data:image/*;base64` source whose SHA-256 and stored source metadata match a live `ATTACHED` MediaAsset with the authoritative owner and purpose. The asset must have a valid aspect ratio and display variant; post cleanup accepts only the exact `sortOrder=0` attachment. Public assets require a public display object; all other scopes require a private non-master display object. Apply downloads every chosen object and verifies byte size, MIME, width, and height before the first database write.

The write uses exact entity/source/media/variant predicates. A concurrent edit becomes a conflict rather than clearing changed data. Any skip, storage failure, conflict, database failure, or nonzero remaining count produces a nonzero exit. Logs contain aggregate counts and reason buckets only; they never include Base64 values, object keys, URLs, or entity IDs. The command nulls legacy columns only and never deletes MediaAsset, MediaVariant, or storage objects.

## Recovery

The migration is additive. Do not drop the media tables or legacy columns during incident response.

- Frontend failure: redeploy the previous frontend. Backend legacy fields remain readable.
- Backend failure: roll back to the previous backend while leaving the additive schema and buckets intact.
- Storage failure: stop uploads/backfill, preserve legacy reads, and fix bucket/policy configuration.
- Backfill failure: stop the command, keep its exact cursor and summary, correct the cause, then rerun the same domain. Already attached records are skipped.
- Privacy concern: stop frontend/backend rollout, disable media uploads if necessary, and restrict affected exact asset IDs. Do not bulk-delete.
- Database migration failure: stop deployment and restore through the approved production database recovery process. Never run an ad hoc destructive `db push`.

Public promotions occur before the database attachment transaction and are rolled back on transaction failure. Public-to-private transitions keep authorization restrictive while public variants are being removed.
