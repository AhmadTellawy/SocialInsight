# Validation evidence

- Implementation snapshot: `2062cabd25ff8517db96bb5e297ae36706ff1eb1`
- Original security base: `870ce07e0ba08bda913d67293ff4bf9c5efdd713`
- Current production revision merged into the release: `689b64dfba705f29a2a635fa5abff937745dc4fb`
- Published GitHub branch: `codex/security-remediation-release` at commit `1f74f4213e8485b8d8ad913990533ec70e4f99c9`
- Environment: isolated Windows release worktree; local PostgreSQL 17.11 on `127.0.0.1:55447`; no production data used.

| Check | Result | Evidence |
|---|---|---|
| Frontend unit suite | PASS | 129 passed, 0 failed |
| Frontend production build | PASS | Vite 6.4.3 built 1,895 modules; PWA service worker generated |
| Server full suite | PASS | 446 passed, 0 failed, 558079 ms |
| Server build | PASS | Prisma Client 6.12.0 generated; TypeScript compilation passed |
| Post update moderation target | PASS | 39 passed, 0 failed |
| Playwright production-preview journeys | PASS | 45 passed, 0 failed across English mobile, Arabic mobile and English desktop |
| Playwright real follow-hook journeys | PASS | 9 passed, 0 failed across the three projects |
| PostgreSQL media lifecycle integration | PASS | 27 passed, including late source-write cleanup and split cleanup fences |
| PostgreSQL profile/search integration | PASS | 8 passed |
| OTP migration rehearsal | PASS | Legacy v1 consumed; v2 issued and consumed; expected constraints/index present |
| Fresh migration deployment | PASS | All 20 migrations applied to a fresh PostgreSQL database |
| Dependency audit | PASS | Root: 0 vulnerabilities; server: 0 vulnerabilities |
| Changed-file secret pattern scan | PASS | 0 matching secret patterns; no values recorded in task evidence |
| Independent code review | PASS | E03 found no unresolved correctness or maintainability findings on the final implementation snapshot |
| Independent local QA gate | PASS | E01 accepted the complete local evidence on the implementation snapshot |
| Scoped company validator | FAIL | 655 checks passed; unrelated task-staging exact-selection root-drift contract failed 1 of 645 schema cases |

Operational notes:

- Production Render now has the required secret names `AUTH_SESSION_HASH_SECRET`, `OTP_HASH_SECRET`, `OTP_CODE_PEPPER` and `TRUST_PROXY_HOPS=1` saved without deploying the blocked code. Secret values are not recorded.
- Production Vercel and Render remain on `689b64dfba705f29a2a635fa5abff937745dc4fb`.
- The GitHub remote branch was verified to match the local commit exactly after push.
- The Vercel preview for this branch is deliberately disabled because its rewrites target the production Render backend.
- Database timezone was set to UTC in the isolated rehearsal; production UTC verification remains a deployment preflight.
