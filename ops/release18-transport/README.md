# DB18 Stage read-only transport candidate

This directory is a local implementation candidate. A01 owns exact-byte integration into the operations checkout. Independent E03, E01, E04, D04 and F01 disposition is required before credential access or provider execution. It does not approve or perform a migration, application deployment, provider change, account-setting change, or legal adoption.

The unchanged frozen DB18 package is bound by SHA-256 c74ce2ef9946377b793a723ea0efc6b4fbbd0210fc84d4882b47d54568b6271f (50 source files). The only hosted target is service srv-dagsvgek1f9s73dqpg7g, Stage project mnfiixtgnlzmduunfryt, session pooler aws-0-ap-southeast-1.pooler.supabase.com:5432, database postgres, pooler user postgres.mnfiixtgnlzmduunfryt. No direct, production, arbitrary host, or legacy DB15 capture route exists.

## Execution boundary

The seven production files listed in contract.mjs RUNTIME_FILES form the runner source digest, including every newly executed/imported cache, publication and preparation module, the approval schema, and SQL. frozenPackage verifies all 50 frozen source bytes before importing frozen helpers. No runtime download, package repair, configuration module, dotenv or hook discovery is permitted in capture.

capture.mjs accepts exactly:

    node ops/release18-transport/capture.mjs capture --approval-file /absolute/f01-approved.json --run-id UUID

F01 must independently provide the exact-byte config SHA in RELEASE18_TRANSPORT_APPROVED_CONFIG_SHA256; the schema contains no real password. The only allowed password variable is RELEASE18_DB_ADMIN_PASSWORD. Approval binds exact service, git HEAD/RENDER_GIT_COMMIT, run UUID, target, c74 source, seven-file runner digest, cache manifest SHA, independent gates, separately accepted controlled TLS proof, projection mode, and a window of at most 30 minutes with more than 10 minutes remaining. Future, stale, unknown, extra, mismatched and replayed inputs reject before the password property is read. Credential/hook/proxy/TLS-bypass variable names reject without reading their values. The two known provider BASH_FUNC helper bodies are ignored and never forwarded or evaluated.

Capture reserves a unique 0700 directory outside the checkout at /tmp/opiniup-release18-transport/UUID. It generates a nearest private package.json and explicit datasource schema, then copies the fully verified public toolchain cache there before credentials. The package.json boundary and cwd prevent ancestor package.prisma lookup; private-cwd tests separately exercise the actual pinned CLI. Existing checkout .env files are not read or deleted. All six prisma.config suffixes, dotenv and rc files are rejected in the actual execution boundary. Realpath, hardlink, owner and mode checks protect private/cached files.

After a final source/config/time check, capture reads the password once, constructs the fixed frozen TLS URL with pinned CA/CLI/native engine and startup UTC, lock_timeout=5000, statement_timeout=120000, connect_timeout=10, connection_limit=1, default_transaction_read_only=on and an invocation tag. Only the absolute pinned CLI db execute --file --schema subprocess follows. transport.sql performs BEGIN READ ONLY, fixed metadata assertions including current backend pg_stat_ssl, current user/database, transaction/default read-only state, UTC, timeouts and tag; it ends with ROLLBACK. No application row, ACL listing, query output, cancellation function or migration is used. The total capture budget is 120 seconds, SQL child budget at most 60 seconds, with a five-second cleanup reserve through the unchanged process helper.

## Concrete credential-free cache protocol

Render documents persistence for XDG_CACHE_HOME, not arbitrary nested node_modules: https://render.com/docs/deploy-nextjs-app (Caching). Two separately reviewed credential-free builds must precede any secret Link.

1. On the final reviewed operations commit, with no credential-bearing variables available:

       node ops/release18-transport/prepare-cache.mjs prepare-cache

   This executes only the frozen DB18 package protocol: npm ci (300s), node launch.mjs verify (60s), node tests/tls.mjs (210s), then verifyRuntime. Child output is bounded and discarded. It copies regular public dependency bytes into XDG_CACHE_HOME/opiniup-db18-toolchain/<canonical-manifest-SHA>, excluding unused npm .bin links. The manifest binds exact Node version, c74, runner source digest, lockfile, CLI, engine, CA, preparation commit, every relative file path/length/SHA/executable flag. No credentials, private capture receipt, SQL result or approval file enter this dependency cache.

2. In a fresh credential-free build on the same reviewed source and exact Node version:

       node ops/release18-transport/prepare-cache.mjs verify-cache --manifest-sha256 SHA

   This verifies the approved cache, copies it to a new 0700 directory and runs the pinned native runtime verification. It performs no npm, install, network or repair. Missing, stale, corrupt, extra, symlinked, hardlinked, wrong-mode, wrong-lock, wrong-source or wrong-Node cache inputs fail closed. F01 records the two real deployment IDs, operations commit, manifest SHA, source SHA and provider-log digest. Local fixture cache tests do not establish Render persistence.

Both credential-free modes accept and strip only the exact legacy STAGING_INITIAL_INSTALL_MODE=verify selector. Capture rejects every STAGING_ variable, so that selector must be removed through the reviewed provider action before capture. No legacy password group is silently reused. Both cache modes generate their own minimal ops/public-result/index.html and per-run JSON; they do not rely on a previous build's static output.

## Proof, publication and transfer into frozen preflight

The config supports SUMMARY_ONLY and REVIEWED_SANITIZED_PROOF. E01/E04 accepted the latter as a low-sensitivity design; final implementation review and F01 action authorization are still required. SUMMARY_ONLY publishes status, UUID and digests and cannot alone transfer the complete frozen proof. REVIEWED_SANITIZED_PROOF publishes an explicit allowlist, never a spread of subprocess or receipt output:

- a canonical minimized evidence record with fixed target/runtime facts, source/config/cache/ops digests, UTC times, actual positive TLS/read-only assertions and separately attributed previously accepted controlled negatives;
- the exact frozen prismaTransportProof projection. Its evidenceSha256 hashes the separate canonical evidence record, not itself. The projected observedAt is the older of actual positive and prior controlled-negative observation, so capture cannot renew old negative evidence.

The record makes no claim that controlled wrong-CA/hostname/no-TLS tests were performed on the actual target. Raw stdout/stderr/errors, userinfo URLs, credentials, query text/results, ACLs, rows and private paths never enter public projection or private receipts. Private files contain only fixed metadata and minimized proof.

Projection validation runs before creating success proof. Private proof files are exclusive 0600 writes. The target lock remains on success and failure until F01 disposition. JSON and pending HTML are exclusive writes; index placement is atomic. Any projection, file, rename or emitter failure returns a non-success status and the CLI exits nonzero. Failure records truthfully distinguish transportAssertionsPassed, proofCreated, publicResultPrepared and lockRetained. On a post-proof failure, only this run's exact private evidence/proof/PASSED receipt files move to its 0700 rejected-artifacts directory. Only byte-matching per-run public JSON, pending HTML and index move outside the publish directory to ops/.release18-rejected-output/UUID, then a minimized failed index/result is created. Any quarantine, ownership check or revocation failure is explicitly FAILED_OR_UNKNOWN; the lock and original evidence remain and no automatic cleanup or retry follows. F01 must reject unresolved artifacts and require a successful exact deployment plus retrieved-byte verification. Render must not publish a failed build.

After the successful capture build, F01 retrieves the per-run public JSON and keeps its exact bytes in task evidence. F01 must independently:

1. Recompute evidenceSha256 from JSON.stringify of the explicitly ordered minimized evidence record; recompute proofSha256 from the proof projection and the retrieved JSON-byte SHA. Reject unknown keys or changed values via checkedProjection.
2. Match service, run UUID, source, runner/config/cache SHA, exact operations commit and target to the reviewed invocation and external run ledger. Verify freshness and the separately accepted controlled evidence.
3. Create a separate retrieval envelope with typed fields: schemaVersion=1, kind=F01_DB18_TRANSPORT_RETRIEVAL, serviceId, runId, operationsCommit (40 lowercase hex), deployId (actual dep- identifier), sanitizedProviderLogSha256, retrievedPublicJsonSha256 (both 64 lowercase hex), retrievedAt (UTC), runnerSourceSha256, approvedConfigSha256, cacheManifestSha256, evidenceSha256 and proofSha256. The deployment ID and provider-log digest are observed after the build; the capture process does not invent them.
4. Put only the validated prismaTransportProof object into the unchanged DB18 preflight approval, bind that new approval's exact bytes through the separate frozen RELEASE18_APPROVED_CONFIG_SHA256 trust channel, and bind preflight's own new UUID/command/current operations commit/service/gates/window. The frozen validateApproval compatibility test exercises this exact projection and rejection of stale/wrong target/source/commit/replay inputs.

Neither a public JSON object nor a capture PASSED line authorizes preflight/deploy. Static Site private artifact retrieval is not required for this approved minimized transfer. F01 retains the retrieval envelope and original safe record bytes for recomputation.

The /tmp capture lock protects only its execution filesystem. It is not a distributed fence across fresh Render builds. F01 must retain the external invocation/deploy ledger, prevent competing or replayed builds, and treat missing/interrupted outcomes as unknown until independently resolved. No automatic retry, cleanup of foreign state, password rotation or credential Link is implemented here.

## Validation and handoff

Focused offline tests cover approval/environment/source/config guards, password-read spies, exact readonly SQL/argv/environment, process results, cache corruption/copy, publication failure injection, secret sentinels, canonical transfer and frozen preflight compatibility. Existing-Ajv JSON Schema validation is a separately attributed local check; Linux does not install an unrelated root toolchain. Schema/runtime structural drift checks do not claim full JSON Schema validation.

Credential-free Linux CI should install only the unchanged DB18 package via npm ci, use pinned Node 24.20.0, and set:

    RELEASE18_TEST_PACKAGE_ROOT=/work/server/scripts/release-db-18
    RELEASE18_TEST_CLI=/work/server/scripts/release-db-18/node_modules/prisma/build/index.js
    RELEASE18_TEST_ARTIFACT_ROOT=/work/transport-test-artifacts

Then run the E02 linux-test-setup.sh synthetic TLS PostgreSQL fixture and:

    node --test --test-concurrency=1 ops/release18-transport/*.test.mjs

E02 owns linux-integration.test.mjs and linux-test-setup.sh. Their actual pinned CLI/TLS/SQL/process evidence is local synthetic evidence, not hosted transport. Root owns the existing CI workflow and final exact-byte worktree integration. Windows timing failures and Linux skips must stay attributed to their actual environment in the task receipts; historical mutable-input results do not approve the final source snapshot. FE/BE and application/registry tests are N/A to this ops-only candidate under E01 selection. No unchanged full DB18 suite is silently counted or repeated.
