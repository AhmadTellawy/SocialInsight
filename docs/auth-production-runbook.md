# Authentication production runbook

This runbook covers the Resend OTP, opaque cookie session, Google OAuth, and Facebook OAuth release. Never paste secret values into tickets, logs, commits, or command output.

## Required production configuration

Configure these names in Render before deploying the backend:

- `AUTH_SESSION_HASH_SECRET`: a new high-entropy secret, independent from provider credentials.
- `AUTH_ALLOWED_ORIGINS=https://socialinsightapp.com`
- `AUTH_COOKIE_SECURE=true`
- `AUTH_COOKIE_SAME_SITE=lax`
- `AUTH_RECENT_TTL_SECONDS=600`
- `AUTH_LEGACY_BEARER_COMPAT=true` for the bounded backend-first rollout only; disable after the frontend proxy is proven.
- `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, and `EMAIL_FROM_NAME` after the sender domain is verified in Resend.
- `OAUTH_CLIENT_REDIRECT_URL=https://socialinsightapp.com/login`
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_OAUTH_REDIRECT_URI=https://socialinsightapp.com/api/auth/oauth/google/callback`
- `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, and `FACEBOOK_OAUTH_REDIRECT_URI=https://socialinsightapp.com/api/auth/oauth/facebook/callback`

The Google OAuth client must list the exact Google redirect URI above. The Facebook Login product must list the exact Facebook redirect URI above. Keep development credentials and callbacks in separate provider applications.

## Pre-deployment gates

1. Take a database backup and record the recoverable backup identifier without exposing credentials.
2. Rehearse `prisma migrate deploy` against a staging copy and verify the backend database role can use all auth tables while `anon` and `authenticated` cannot.
3. Confirm no case-insensitive duplicate user emails exist before the unique `lower(email)` index is created.
4. Verify the Resend sender domain and send bilingual registration, reset, verification, and email-change messages to controlled test mailboxes.
5. Exercise Google and Facebook login and explicit account linking with success, denial, replay, wrong-browser, and existing-email collision cases.
6. Through the Vercel preview proxy, verify `Set-Cookie`, CSRF, OAuth callbacks, uploads, and the Socket.IO WebSocket upgrade on desktop and mobile.
7. Run the repository frontend/backend suites and the auth Playwright suite on the exact release commit.

## Ordered rollout

1. Enable `AUTH_LEGACY_BEARER_COMPAT=true` with a maximum legacy token TTL of one hour.
2. Deploy the backend. Its build must compile before `prisma migrate deploy`; stop if compilation or migration fails.
3. Smoke login, reset request, health, and an authenticated read without changing real user data.
4. Deploy the Vercel frontend containing the same-origin `/api`, `/socket.io`, and `/uploads` rewrites.
5. Smoke email login, logout/revocation, registration OTP resend, password reset, email add/change, both OAuth providers, and Socket.IO reconnect.
6. Watch error rate, auth latency, `RATE_LIMITED`, OTP delivery failures, OAuth callback failures, session creation/revocation, and WebSocket authentication failures.
7. After the supported old-client window closes and cookie-session traffic is proven, set `AUTH_LEGACY_BEARER_COMPAT=false` and redeploy the backend.

## Rollback and forward-fix

- Frontend regression: roll Vercel back to the previous verified deployment while keeping backend compatibility enabled.
- Backend regression before auth writes: roll back the service build; do not run a destructive database reset.
- Backend regression after auth writes: keep the new tables and use a reviewed forward-fix. Dropping session, OAuth, OTP, or rate-limit tables would destroy security/audit state.
- Provider outage: leave email login available, surface a generic recoverable error, and disable only the affected provider entry point if necessary.
- Resend outage: do not mark OTP as delivered; preserve the generic password-reset response and monitor delivery-failure events.

## Evidence required to call the release production-ready

Record the deployed commit, migration result, provider callback screenshots or provider-console evidence, controlled mailbox message IDs, Vercel/Render deployment identifiers, smoke-test results, monitoring window, rollback decision, and any skipped check. A successful push or build is not deployment proof.
