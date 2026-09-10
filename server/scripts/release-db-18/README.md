# Release database 18: prepared package

This package is a new, independently reviewable release executor. It does not modify or replace the immutable 15-migration package under `ops/`. Application source is frozen at `9a8a3aeea6b614fbd58421d0fc1f1c01b36eb4ef`; operations base is `583cee66281aef4519d87d0d06af4616c30d9719`.

Preparation is not hosted readiness. No hosted connection, migration, backup, runtime-ACL provision or release approval is produced by local verification. Root/F01 retains external execution authority.

## Commands

From this directory, install only the pinned lock with `npm ci` in a clean, credential-free dependency job. Do not run a repository-wide application build or inherit npm configuration into the migration subprocess.

```text
node launch.mjs verify
node launch.mjs preflight STAGE_EMPTY --transport direct --run-id <new-uuid-v4> --approval-file <absolute-approved-config-path>
node launch.mjs deploy STAGE_15 --transport session --run-id <new-uuid-v4> --approval-file <absolute-approved-config-path>
node launch.mjs deploy PROD_10 --transport direct --run-id <new-uuid-v4> --approval-file <absolute-approved-config-path>
```

These are the only production command modes. There is no reset, resolve, retry, arbitrary URL or repair command. The old Stage launch/build/TLS/parity files remain untouched.

| Profile | Required successful ledger | Applied migrations | Target |
|---|---:|---|---|
| STAGE_EMPTY | No ledger; completely empty public schema | 1–18 | mnfiixtgnlzmduunfryt |
| STAGE_15 | Exact 15, no rollback/active failure | 16–18 | mnfiixtgnlzmduunfryt |
| PROD_10 | Exact 10 plus the reviewed historical rolled-back migration 9 | 11–18 | jlanmsxfggpnbwoowejy |

Stage permits its fixed direct host or fixed session pooler on 5432; either must prove backend TLS. Production permits only `db.jlanmsxfggpnbwoowejy.supabase.co:5432/postgres`. The previously observed Production pooler had an unencrypted backend leg and is excluded. Node-pg's direct Production probe is a useful prior observation, not Prisma proof.

Migration 10 has two deliberately bound byte representations: Stage LF `5b89b5d2e1ad7464ca7fb98849c010c5bd8cc7ebdc826621c588f39c139910b4`; Production CRLF `6c523622f3a261b11eacdd71a541fca178f0f757c36852f32325d7f486363f21`. The sole overlay is byte-checked and used only in PROD_10. Historical ledger checksums and rollback rows are never rewritten. Final Production success has 18 successful rows and the retained historical rollback row, not necessarily 18 total rows.

## Independent runtime binding

F01 must independently review the real gate, target, fence, backup, Stage and transport evidence, then supply an execution configuration conforming to `approval.schema.json`. F01/runtime approval installs that exact file's SHA-256 separately as `RELEASE18_APPROVED_CONFIG_SHA256` in the controlled job environment. The file path alone is not trusted. This uses the existing manual approval boundary and creates no new signing keys or self-approval mechanism. The job environment and trusted digest must not be supplied by the unreviewed application or generated automatically from a candidate config.

The reviewed job must also expose matching `RENDER_GIT_COMMIT` and `RENDER_SERVICE_ID`. The launcher compares the actual checkout commit. It validates the config hash, source, fixed target, run UUID, command, service, UTC validity window and evidence before evaluating `RELEASE18_DB_ADMIN_PASSWORD`. Only that dedicated approved password variable is used. Application URLs, PG environment overrides, old Stage credentials, NODE_OPTIONS and debug configuration are rejected. No actual credentials belong in this package or its approval file.

The approval lifetime is at most 30 minutes and must have over 10 minutes remaining before execution. Deploy requires five current independent source-bound gate references (E03/E04/E01/D04/F01), an active fence observed within five minutes and valid through the approval expiry, a verified backup with restoration and journal-coverage evidence within 24 hours, a runtime journal ACL plan, approved fresh baseline capture, and Stage acceptance for Production. These are prerequisites recorded by the authorized reviewers, not facts that the executor can create or certify merely by reading boolean fields.

The transport proof must bind this package, this contract, the selected target/transport, the actual Prisma 6.19.2 CLI and native Linux schema engine, and the pinned CA. It must include actual target backend TLS, strict peer rejection, no credential disclosure to rejected peers, no plaintext fallback and per-connection UTC/5s lock/120s statement settings. It expires after 24 hours. The historical old-contract Stage proof is not relabeled as this proof. New transport-proof capture is a separately authorized read-only operation; absent evidence blocks execution before password access.

## Execution and data checks

Only Prisma CLI/schema engine perform migrations. Pinned `pg@8.23.0` performs bounded read-only baseline metadata/digest capture in a repeatable-read transaction, with strict CA/SNI peer verification and `pg_stat_ssl` checks for hosted routes. Its transport evidence is distinct from Prisma evidence. No application Prisma Client, custom wire client, persistent audit tables, database defaults or role defaults are introduced.

Every Prisma URL supplies `timezone=UTC`, `lock_timeout=5000` and `statement_timeout=120000` through startup options. Guards assert effective settings without SET LOCAL overrides. Prisma preflight and postflight are bounded to 60 seconds each, migration to 360 seconds, and the complete job to 600 seconds. Fifteen seconds of the remaining whole-job budget are reserved before each phase for process/database cleanup. Local rehearsal checks real Prisma settings and rejects a deliberately unbounded/non-UTC connection.

Preflight assertions reject unknown history, changed checksums, partial future schema, identity/vote collisions, inconsistent answer relationships/counters, missing canonical indexes and unresolved media upload bucket references. Read-only legacy group/auth/media inventory remains evidence to review; canonical group membership and pending media transitions are preserved, not silently repaired. The captured baseline covers every original application table and column. Pre/post assertions compare ordered SHA-256 digests and row counts, including the historical rollback metadata, while avoiding user values in logs. Snapshot metadata is private local evidence, not public status.

Postflight verifies 18 successful migrations, exact table set, valid constraints/indexes, handle aliases and deleted-user tombstones, empty newly introduced outbox/journal, 13 sensitive RLS tables, restricted client grants and migration-15 cleanup deadlines on Production. This does not provision or prove the separately required non-owner/NOSUPERUSER/NOBYPASSRLS runtime journal role. Actual SELECT/INSERT success and UPDATE/DELETE/TRUNCATE denial remain a cutover gate. Application startup stays a separate authorized release.

## Unknown outcomes

Each run creates an exclusive private receipt before database access. Deploy also acquires a target-specific local lock. Child stdout, stderr and error objects are suppressed, including on timeouts; public output contains only fixed statuses and non-secret identifiers. A failed write-capable phase or postflight yields FAILED_OR_UNKNOWN and retains the lock. A new UUID cannot bypass that lock. No automatic retry or ledger repair occurs.

On Linux the pinned Prisma CLI runs as leader of a dedicated process group. Timeout, parent SIGTERM/SIGINT, excessive output or lingering descendants trigger bounded group termination: TERM, up to 1.5 seconds of grace, then KILL if needed, within a five-second cleanup budget. The receipt distinguishes live processes from terminated zombies and records inability to inspect or terminate the group. Windows remains local-fixture-only; its direct-child cleanup is not reported as verified Linux process-tree termination.

Each actual Prisma connection is tagged with the run UUID through application_name; the Linux interruption test observes the tag on the real schema-engine connection. After a failed phase, the executor uses up to eight seconds to verify the fixed target/principal/TLS and observe only this run's backends. After a short read-only grace period, a persistent query may receive pg_cancel_backend only when its captured PID and backend_start still match the exact database, postgres principal, run application_name and client-backend type. New/mismatched identities are not cancelled. No pg_terminate_backend, broad cancellation or history repair is performed. The receipt records each cancellation attempt and independently observed connection disappearance; errors, timeouts and uncertain cleanup are retained. Query termination is not proof that DDL never committed or that a migration rolled back. UNKNOWN and its target lock remain even when cleanup is verified; retain the external writer fence until verified quiescence and an explicit F01 disposition.

Keep the external writer fence in place. Use reviewed read-only queries in `sql/inspect-state.sql` to establish actual history/catalog state. A completed ledger still needs read-only postflight confirmation; a partial prefix or active failed row needs separately reviewed recovery. An authorized operator may remove the specific local lock only after the investigation and a new F01 execution disposition; the package has no unlock command. Do not infer rollback from a lost connection. Keep receipts outside any public static root; publish only an independently sanitized summary with applicationDeployment=false.

The lock applies only to the persisted execution directory; it is not a distributed exactly-once guarantee. A replaced provider job or missing receipt after interruption remains UNKNOWN under the external fence. Do not regenerate approval or rerun automatically when local state is unavailable. Root/F01 must retain independent execution evidence and issue a new disposition after investigating the actual database.

## Local and Linux verification

```text
node --test --test-concurrency=1 tests/guards.test.mjs
node tests/rehearse.mjs
node tests/tls.mjs
node tests/interruption.mjs
```

The local rehearsal connects only to `127.0.0.1:55447`, uses the approved synthetic postgres fixture credential and creates fresh `si_release18_` databases. It never drops databases or changes their defaults. It exercises empty, populated Stage-15 and populated Production-10 baselines, the rolled-back migration-9 row, row/column preservation, real Prisma startup settings and preflight rejection before migration 11. Windows reuses the already installed candidate Prisma and local fixture pg package; Linux uses this package's locked dependencies and requires a PostgreSQL 17 service exposed at port 55447 with the same synthetic fixture credential. No provider credentials may be inherited.

The controlled TLS peer is adapted from the reviewed `ops/stage-engine-tls/run-engine-tls.mjs` harness (old SHA-256 `0d73fb8c77e3a232e7c63c3accf121ca7a48805c926c157a5b98cf9fdb2409b1`). It is a local test server, not a replacement database or a custom operational wire client. The real schema engine must reject wrong CA, wrong hostname and absent TLS before credentials; the positive peer must observe the new startup options. Real GUC enforcement is separately checked against PostgreSQL. Test certificates are synthetic and removed; all results stay under ignored `evidence/`.

The Linux interruption proof uses two additional fresh synthetic databases. After successful real preflight it holds a fixture-only relation lock, observes the immutable migration16 actively waiting through the actual pinned CLI/schema engine, and tests both a four-second local test timeout and SIGTERM sent to the executor parent. It verifies the actual application_name tag, running engine bytes/group membership, bounded descendant cleanup, independent database inactivity, durable UNKNOWN receipt/lock and rejection of a new run UUID. Its local test timeout does not change the hosted six-minute migration limit. The old f387ba2a package and successful Linux CI evidence remain historical evidence; they did not establish process-tree termination.

`prepare-source.mjs` is a maintainer preparation tool, not a runtime release command. It copies exact Git blob bytes from the fixed candidate and regenerates the manifest after approved package edits. Run it only before source freeze. Root owns copying sanitized evidence to the task record, final source freeze, independent review, commits/pushes, provider configuration and authorized Stage/Production execution.
