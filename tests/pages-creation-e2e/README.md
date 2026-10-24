# Page creation integration checks

Run `npm run build` and, from `server`, `npm run build` before `npm run test:e2e:pages-creation`.

The fixture starts a fresh PostgreSQL cluster on loopback port 57687 and a local HTTP server on 4193. It applies the repository migrations and provisions a newly generated test-only Page context key. It uses the real Page router, cookie sessions, CSRF checks, Prisma persistence, and actual PageCreate/PageManage components. Session issuance is a test fixture, not a test of password/OAuth sign-in. No production services or data are used.

This local Windows setup uses the existing embedded PostgreSQL binaries and `pg` package under `D:/socialinsight-20261006/.ai-company/memory/tasks/SI-CREATE-TWO-STEPS-20260906/local-postgres/`. It writes evidence under the current task directory. These machine-specific paths are isolated to test files. Chromium must be available to Playwright.

The DB login is a local superuser; these checks do not certify restricted-login RLS. Service authorization, anonymous/other-account access, CSRF, draft persistence, validation, retry, and publication are covered. Global teardown stops the owned cluster and retains its synthetic data for inspection. A setup failure also attempts cleanup. If interrupted, use the task cleanup helper, which verifies the exact data-directory identity before stopping anything.
