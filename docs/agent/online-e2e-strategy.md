# socialinsight Online E2E Strategy

## Decision

During the current development phase, all Playwright E2E tests target the deployed online socialinsight environment only.

Local frontend and local backend E2E execution is intentionally excluded. The purpose of E2E testing in this phase is to verify the actual deployed app, not unpublished local code.

## Canonical URL

The canonical online frontend URL is:

- `https://socialinsightapp.com/`

`E2E_BASE_URL` is the only canonical override variable for Playwright E2E runs.

The following E2E targets are not allowed in this phase:

- `localhost`
- `127.0.0.1`
- `0.0.0.0`
- private network IPs
- non-HTTPS URLs
- any host other than `socialinsightapp.com`

Tests must fail fast when the resolved E2E URL is not the approved online target.

## Test Classes

### ONLINE_NO_WRITE

ONLINE_NO_WRITE tests must not intentionally create, update, or delete data.

Examples:

- app-load smoke
- login page render
- navigation smoke
- poll advanced settings UI
- mobile layout smoke
- language/RTL smoke
- read-only authenticated checks after storageState exists

### ONLINE_CONTROLLED_WRITE

ONLINE_CONTROLLED_WRITE tests perform a narrowly approved write and cleanup flow.

Examples:

- login with a dedicated test user
- create one `e2e_` poll
- capture the created post ID
- verify the created post appears
- delete only the captured post ID
- verify cleanup

## Controlled-Write Safety Rules

- Use dedicated test accounts only.
- Never use the owner's real account.
- All test-created content must use the `e2e_` prefix.
- Capture the created ID before cleanup.
- Cleanup may delete only the exact captured ID.
- Do not bulk delete.
- Do not delete by title.
- Do not clean up old data unless separately approved.
- Do not use direct database cleanup.
- Do not run Prisma commands.
- Do not run migrations.
- Do not make destructive API calls outside captured test artifacts.
- Do not run follow, privacy, notification, vote, comment, like, save, share, report, or push-subscription write tests unless explicitly approved.

## Authentication Rules

- Auth setup targets the online environment only.
- Auth state lives under `tests/e2e/.auth/`.
- Auth state must be gitignored.
- Credentials are supplied only through local environment variables or `.env.e2e.local`.
- Never print credentials, cookies, tokens, localStorage, headers, or storageState contents.

## Evidence Rules

- ONLINE_NO_WRITE tests may be run frequently.
- ONLINE_CONTROLLED_WRITE tests require explicit approval.
- If a test fails, report screenshots, traces, and videos by path only and do not expose tokens.
- Generated artifacts that may contain tokens must be handled as sensitive local artifacts.

## Future Migration

After development is complete, create a dedicated test database or test environment.

Broad write-flow coverage should move to that dedicated environment before expanding beyond the controlled online write tests listed above.
