# Authentication production runbook

## Required configuration

- Configure `AUTH_SESSION_HASH_SECRET`, `OTP_HASH_SECRET`, and `OTP_CODE_PEPPER` with separate, high-entropy values. Never reuse or log their values.
- Configure `AUTH_SESSION_TTL_SECONDS` for the absolute session lifetime and `AUTH_SESSION_IDLE_TTL_SECONDS` for the shorter inactivity lifetime.
- Configure `SOCKET_SESSION_REVALIDATE_SECONDS` between 15 and 300 seconds. A database failure during revalidation disconnects the socket.
- Keep the Socket payload, heartbeat, handshake, and open-connection limits in `server/.env.example` conservative. The database-backed handshake budget spans replicas; the open-connection limit is a per-process circuit breaker and must be checked against the replica count.
- Configure `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops between the Render edge and the Express process. The example value is `1`; verify it against the active Render topology before release.
- Keep `OTP_TTL_SECONDS` at or below 1800 seconds. Version-1 OTP rows created before this release remain valid only until their stored expiry; every new OTP is written with hash version 2.
- Set `OTP_DESTINATION_HOURLY_LIMIT`, `OTP_DESTINATION_DAILY_LIMIT`, and `OTP_GLOBAL_DAILY_LIMIT` from the verified email-provider budget. These database-backed counters apply across purposes, registration attempts, restarts, and replicas.

## Deployment order

1. Add the required configuration to staging without printing secret values in logs or evidence.
2. Apply the additive Prisma migration. It preserves existing OTP rows with `hash_version = 1` and adds no destructive data operation.
3. Deploy the application. Confirm that a newly issued challenge records `hash_version = 2` and that only a digest and bcrypt hash are stored.
4. Exercise registration, password reset, email verification, email change, login, logout, session revocation, and Socket disconnect behavior with test accounts.
5. Repeat the configuration and migration on production, deploy the traceable commit, and run non-destructive smoke checks.

## Rollback and recovery

- Application rollback is compatible with the added nullable/defaulted columns. Do not drop the columns during incident response.
- If `OTP_CODE_PEPPER` is absent or incorrect, OTP issuance or verification fails closed. Restore the configured value and redeploy; do not bypass OTP verification.
- If session revalidation detects a database outage, sockets disconnect and clients reconnect after the database recovers.
- If proxy hop configuration is wrong, correct `TRUST_PROXY_HOPS` before reopening rate-limited authentication traffic.
