# Reels implementation and release handoff

Branch: `codex/reels-end-to-end`, based on `b5067e944493db7e67d12daa8689300a8c913709`.
The founder authorized implementation and subsequent online deployment. This document is not evidence of a deployment. Work and verification are performed in the main session only; no independent release approval is claimed.

## Product behavior

- `/reels` replaces the Trends tab; `/trends` redirects to it. Vertical snap navigation, up/down keyboard controls, physical right swipe to the publisher, and return to the same Reel and playback position.
- One active video player, muted initially, pause/mute controls, tab visibility pause, short-lived signed HLS playback, loading/error/retry states. Opening a sheet pauses the video while retaining its frame.
- The question action sits above the existing Like action. Likes, comments, reposts, sharing, results, reporting, and post management reuse `SurveyCard` and `SurveyActions`. Existing white `BottomSheet` components remain authoritative.
- Creation: upload or browser recording → original question/survey/quiz editor → original publishing/settings screen → preview → publish. The editor stays mounted during preview. Personal and Page publishers, groups, draft/pending/publication behavior use existing post APIs.
- Text-only questions and answer choices; rating/text answers supported where the existing editor permits them. Up to 10 questions, 2–6 options per choice question. One video, MP4/MOV/WebM, at most 60 seconds and 150 MiB; provider metadata is authoritative.
- Retained settings: destinations/profile/groups, results audience/timing, response duration, comments, anonymity, and applicable multiple selection. Removed: question/option/post images, participant-added options, additional demographic questions/presets, Custom Audience and Custom Domain.
- Response expiry closes participation only. It does not expire the video. All required questions submit in one transaction; retries do not duplicate counts. Quiz grades come from the server. Published read surfaces redact quiz keys, including the author-facing feed; the draft editor retains its authorized keys.
- Existing published-quiz editing must therefore reselect correct answers if the editor was opened from a redacted feed. Do not expand public read access to solve this. A separately authorized editor-only contract would require its own review.

## Data and authorization

`Post.presentationFormat` distinguishes standard posts and Reels. A unique `videoAssetId` attaches an owned ready video; retries use that attachment as a creation receipt. `Response.completedAt` seals a completed Reel submission. Existing post audience, Page lifecycle, account, group, block, results and interaction checks remain in force.

`VideoAsset` is backend-only. The additive migration enables RLS, revokes direct `anon`/`authenticated` access, and grants only the trusted API runtime role access. Owner/current Page-editor checks run on the API; browser checks are not authorization. Ready-state checks require a provider ID, duration and dimensions. No original-video fallback or public storage object is exposed.

The provider creates a private resumable upload. The browser transfers chunks directly to Cloudflare; Render does not buffer/transcode video. Upload creation has durable account/network limits. An asset UUID in `Upload-Creator` supports orphan reconciliation after a lost provider response. Exact-byte signed callbacks are verified and the authoritative provider state is re-read. Cron reconciliation recovers missed callbacks.

Unattached uploads expire after seven days. Cancelled assets enter a durable deletion queue. Deleted posts retain videos for the existing 30-day recovery window; deleted personal accounts trigger cleanup. Page-owned content remains with its Page when its original uploader is deleted. Each maintenance pass is bounded to 20 candidates and failures retain retryable pointers and sanitized event logs.

Signed playback grants last five minutes, so previously issued grants can remain usable for that bounded interval after a permission change. Every new grant rechecks current canonical visibility. Tokens, provider responses and private keys must not be logged or placed in persistent browser storage.

## Required production configuration

All values are **server-only**; never add them as `VITE_*` variables.

| Variable | Purpose |
| --- | --- |
| `REELS_ENABLED` | Keep `false` until migration, provider, staging and release checks pass |
| `STREAM_ACCOUNT_ID` | Verified Cloudflare account owning the Stream library |
| `STREAM_API_TOKEN` | Scoped Stream management credential |
| `STREAM_SIGNING_KEY_ID` | Provider signing key identifier |
| `STREAM_SIGNING_KEY_PEM` | Base64-encoded RSA PEM private key |
| `STREAM_CUSTOMER_CODE` | Customer playback hostname component |
| `STREAM_WEBHOOK_SECRET` | Provider webhook signing secret |

Register the existing backend URL `/api/reels/webhook` with Stream. Verify exact account, webhook secret, signed-URL enforcement and allowed browser upload origins. Existing Cloudflare Images configuration does not establish Stream availability or billing approval. No paid service, new key or subscription has been provisioned by this implementation.

## Rollout procedure and acceptance

1. Resolve the current Vercel connection's project-scope 403 and confirm the Render workspace requested by its connector. Re-read actual production deployment IDs, source revisions and service settings; historical IDs are only discovery hints.
2. Obtain the independent review/release evidence required by the repository. MAIN_SESSION_ONLY does not authorize the implementer to approve their own gates or reactivate agents. User deployment authorization is already present.
3. Verify backups and target database identity with read-only queries. Record migration status, table sizes and lock budget. Run `prisma migrate deploy` with the deployment role against the verified staging target first. Never use destructive schema synchronization.
4. Apply migration `20261031090000_reels_video` before running the new API. The existing application can continue using additive columns, but the new API's scalar queries require those columns even when Reels are disabled. Reconfirm Render's actual build/predeploy/start commands; do not assume migrations run there automatically.
5. Configure Stream on staging and run a real upload through TUS, callback completion, signed HLS playback and thumbnail, invalid/expired token denial, owner/other-user/Page/group visibility, callback retry, over-duration failure, interrupted upload, cancellation, draft/publish, and cleanup checks. Browser fixture videos are not a substitute for this provider test.
6. Run current frontend/backend builds and suites, then a staging mobile smoke in Safari/iOS and Chrome/Android for camera/microphone permission, recording codecs, rotation, native HLS, gestures, keyboard/sheets, Back and backgrounding. Check real network interruption and low bandwidth behavior.
7. Deploy the traced backend revision with the flag disabled, verify health/migration state and existing post flows, deploy the matching frontend, then enable Reels only after provider/staging acceptance. Validate the same build at `opiniup.com` and record health, API error/latency, video processing delay and provider usage observations.

## Rollback and monitoring

First disable new Reel creation/grants with `REELS_ENABLED=false`. Roll the frontend and API back to their recorded last-known-good deployment IDs if the release causes regressions. Keep the additive database migration and uploaded records; do not drop tables/columns or erase posted videos. After disabling the flag, existing grants expire within five minutes. On the new API, maintenance continues while the Stream account/token remain configured, even when the feature is disabled. If rolling back to an API version without video maintenance, arrange authorized reconciliation separately.

Stop rollout on authorization/quiz-key leakage, failed migration, existing-post regression, repeated 5xx, callback backlog or provider playback failure. Monitor `http_request_completed`, `reel_video_maintenance_retry`, counts/age of CREATING/UPLOADING/PROCESSING/FAILED/PENDING_DELETE assets, Stream storage/minutes and signed playback failures without recording tokens. Restore only after a forward fix and repeat the affected acceptance checks.

## Verification evidence

The task checkpoint and `verification.json` under `.ai-company/memory/tasks/SI-REELS-IMPLEMENTATION-20261031/` record exact commands and results. Browser tests use actual components, cookie/CSRF middleware, API routers, Prisma and a fresh loopback PostgreSQL database, with a **local video-provider double** and three tiny WebM fixtures. They do not prove live Cloudflare, real-device recording, production migration or online deployment.

`npm run test:e2e:reels` accepts `REELS_TEST_PG_BIN` and `REELS_TEST_PG_PACKAGE` for PostgreSQL binaries and a package directory containing the `pg` driver. Defaults reference the already installed local test runtime on the founder's workstation. Test database folders, logs and receipts stay in ignored `tests/reels-e2e/artifacts/`; teardown stops only the cluster allocated by that run.
