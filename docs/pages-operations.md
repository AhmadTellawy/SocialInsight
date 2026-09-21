# Pages operational controls

This is a release runbook, not evidence of a production deployment.

- `PAGES_ENABLED=true` enables Pages globally. Exact `true` is required.
- `PAGES_TEST_USERS` permits named pilot accounts; discovery still excludes marked test fixtures. A pilot does not start global Page deletion or retention.
- `PAGES_LIFECYCLE_PAUSED=true` pauses new scheduled Page lifecycle cycles while keeping the public feature available. `PAGES_ENABLED=false` also pauses these cycles, even when a pilot allowlist exists.
- A pause prevents the next scheduled cycle; a cycle already in flight finishes its current work. For a migration or recovery that requires zero worker activity, stop the affected API process through the verified hosting operation and verify it has stopped before proceeding. Direct lifecycle recovery calls are explicit operator actions and are not controlled by the timer guard.
- Outbox dispatch follows its recipient feature eligibility checks. A populated pilot allowlist may permit pilot dispatch while the global flag is off. Clear the allowlist when a complete Page feature shutdown is required.

After Page records exist, rollback must use a tested Page-aware build. Historical personal-only code can expose a Page post as its internal human publisher. The local restore rehearsal established this failure for baseline `689b64d`; do not use that revision as the rollback candidate.

Before release: verify the live hosting targets and API origin, freeze and review the candidate, complete applicable QA/security/performance gates, capture a real database backup and media recovery point, prove the additive migration path and compatible rollback. Local loopback restore evidence does not prove the production provider backup or storage recovery path. After authorized rollout, verify version and live smoke checks, clean only recorded synthetic fixtures, and monitor for the required 30 minutes.
