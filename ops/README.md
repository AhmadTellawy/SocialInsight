# Isolated Stage database build job

This directory prepares the initial database schema for the Stage project `mnfiixtgnlzmduunfryt`. It does not deploy the application or configure runtime credentials. The application source is `4d9daeacdd7c7f4cc7a67b3fc1331736597b0037`; `stage-initial-install/source-binding.json` binds the 15 migrations and four supporting files to their exact committed bytes. The public certificate is pinned separately in the installer.

Use a dedicated Stage Static service as a finite build executor only after independent review of this configuration. Repository root directory stays empty. Build command:

```sh
node ops/run-stage-db-job.mjs
```

Set the publish directory to **`ops/public-result`**, never `ops`, the package directory, repository root or application build output. This directory contains only a generated fixed HTML notice and a sanitized status summary. Raw installer output, source, credentials and detailed execution receipts are never published. A failed build produces no new successful receipt.

The default `STAGING_INITIAL_INSTALL_MODE=verify` performs only local byte verification after dependency installation. Build this mode without any linked environment group first. Disable automatic deployment. Record the service, environment, operations commit, build ID and configured publish directory before continuing.

Set the nonsecret Render service variable `SKIP_INSTALL_DEPS=true` at creation and retain it in every mode. Render otherwise installs dependencies automatically before the build command, outside this launcher's filtered environment. Set `STAGING_INITIAL_INSTALL_MODE=verify` explicitly for the first build. See the provider's [Static Sites documentation](https://render.com/docs/static-sites).

This operations branch's `vercel.json` disables Git-triggered Vercel deployments only for `codex/account-settings-stage-bootstrap`. Keep that branch-specific guard when pushing this branch, because the inherited application rewrites target production. Do not treat this repository's frontend as the representative Stage application. Unspecified branches retain their provider behavior; see [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration).

The Linux launcher runs dependency installation with an allowlist of OS path/locale variables and fixed CI flags. Provider credentials, database URLs, tokens, npm configuration and Node hooks are absent from that subprocess environment. Only after installation succeeds does it start the reviewed executor with the configured Stage variables. This limits accidental lifecycle-script logging; dependencies still execute as the builder user, so it is not a sandbox against malicious dependencies. Link no secret files to this service.

For the separately reviewed read-only `preflight` mode, link only `socialinsight-otp-staging-migration`, containing the existing masked `STAGING_DB_ADMIN_PASSWORD`, and set `STAGING_INITIAL_INSTALL_PROJECT=mnfiixtgnlzmduunfryt`, `STAGING_DB_TRANSPORT=session`, and `STAGING_INITIAL_INSTALL_MODE=preflight`. The locked Prisma engine uses the pinned TLS certificate and exact Singapore Session pooler. Do not link runtime or production groups. Credential validity, hosted SQL and engine TLS behavior require actual evidence.

Only after reviewing the preflight receipt, isolation and recovery conditions may the same dedicated executor run the explicit `deploy` mode. Prisma owns the migration ledger. Existing or partly installed application schema stops the initial-install guard; a nonzero/unknown outcome requires inspection rather than retry, reset, `db push` or hand-editing the ledger. Auto-deploy must stay off. These instructions are a proposed execution configuration, not a passed release gate.

Local checks: `node --test stage-initial-install/contract.test.mjs` and `node stage-initial-install/install.mjs --verify`, run from this directory. They do not prove a hosted connection, successful migration or application readiness.

Run `node --test build-stage-db-job.test.mjs` for the synthetic executor failure tests (including a real 60-second configured timeout). Before any network mode, the wrapper requires Render's service and commit identity and generates one UUID for all projected events. Synchronous build-log events record each step before and after execution. Only allowlisted metadata reaches those logs; raw Prisma output is suppressed. A missing, malformed or non-object terminal receipt cannot publish success. Keep the provider build logs and exact build identity as execution evidence, including failed builds; an old successful public status is never proof that a later build succeeded.
