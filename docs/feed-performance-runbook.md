# Feed Performance Runbook

## Measured baseline and result

Measurements are read-only controller probes against the currently configured remote database. The new index migration was not applied during these measurements.

| Path | Before | After |
| --- | ---: | ---: |
| Live authenticated feed, 10 posts | 5.61-6.69 s over 5 warm requests | Measure again after production rollout |
| Authenticated feed, 10 posts | 12.18 s, 23 database events | 2.68-3.57 s, 6 database events / 2 data statements |
| User groups, 14 groups | 6.74 s, per-group count queries | 1.61 s, 5 database events / 2 data statements |
| Initial JavaScript entry | 1,403 kB | 595 kB (178 kB gzip) |
| Feed response | about 63 kB uncompressed | about 6.4 kB gzip |

The remaining database time is dominated by remote transaction-pooler round trips. A normal feed transaction currently pays for `BEGIN`, isolation setup, pooler statement cleanup, and `COMMIT`; each control statement was roughly 0.2 seconds in the measured environment.

## Performance contract

- Normal feed pages execute two data statements; a page containing reposts may execute one additional source-visibility statement.
- Pagination is keyset-based on `(createdAt DESC, id DESC)` and the page size is capped at 30.
- Feed authorization and relation hydration run in one repeatable-read transaction.
- The frontend shows the viewer-specific cached page immediately, refreshes in the background, and never clears valid cache for a transient failure.
- Stale refresh and pagination requests are aborted. Only network, timeout, rate-limit, and server failures receive one bounded retry.
- User groups do not participate in feed success or retry decisions.
- Private/deleted target-group metadata must not be returned to unauthorized viewers.

## Release order

1. Confirm a current database recovery point.
2. Deploy the backend first. The existing `render-build` command runs `prisma migrate deploy`, which applies the additive feed indexes.
3. Verify `/api/health`, then smoke-test guest, authenticated, follower-only, public-group, private-group, blocked-user, repost, and equal-timestamp pagination cases.
4. Confirm structured `http_request_completed` logs show the templated route, status, and duration without user identifiers.
5. Deploy the frontend and verify cached-first rendering, pull-to-refresh, cancellation, and sentinel-only pagination.
6. From the production backend environment, confirm the legacy-media backfill has no unattached candidates:

   ```powershell
   npm run media:backfill -- --batch-size=25
   ```

7. Verify the already-attached legacy Base64 values against both database metadata and the real storage objects:

   ```powershell
   npm run media:cleanup-base64 -- --verify-storage --batch-size=25 --expect-total=38 --expect=user:5,group:0,post:8,question:8,option:17
   ```

8. Only after the verification summary reports 38 eligible, 38 storage-verified, and zero failures, clear the redundant legacy columns:

   ```powershell
   npm run media:cleanup-base64 -- --apply --batch-size=25 --expect-total=38 --expect=user:5,group:0,post:8,question:8,option:17
   ```

9. Rerun both dry-runs. Require zero Base64 remaining and zero unattached backfill candidates, then smoke-test media rendering and privacy.
10. Track warm feed p50/p95, timeout rate, `FEED_TIMEOUT` rate, response bytes, and database pool saturation for at least one normal traffic cycle.

## Operational budgets

- Warm feed p95: under 4 seconds before infrastructure relocation; target under 2 seconds after the app and database are co-located.
- Normal feed data statements: at most 2; repost page: at most 3.
- `FEED_TIMEOUT` rate: below 0.5% over 15 minutes.
- Initial entry JavaScript: below 200 kB gzip.
- Feed payload: below 100 kB gzip for the default 10-post page.

## Remaining infrastructure action

The code no longer has an N+1 critical path, but the application and database connection still have high per-statement latency. Before changing providers, compare a co-located application region and the supported direct/session-pool connection against the current transaction-pool connection under representative concurrency. Keep the transaction pool for burst protection unless load tests show the alternative preserves connection limits and materially lowers p95.

Do not apply migrations with `prisma db push --accept-data-loss`, and do not run the media backfill with `--apply` from a workstation missing the production media-storage configuration.
