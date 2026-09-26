# Release validation — 2026-09-26

- Candidate: `0a95d10cdf96fd3b3e85ad7c42b2ac3f4b72d71c`
- Executable implementation: `2062cabd25ff8517db96bb5e297ae36706ff1eb1`
- Local validation environment: isolated release worktree on Windows.
- Production target: Render service `srv-d70vn4p4tr6s73e2qnjg` and Vercel project `social-insight`.

| Check | Result |
|---|---|
| `npm.cmd run test:unit` | PASS — 129/129 |
| `server/npm.cmd test` | PASS — 446/446 |
| `npm.cmd run build` | PASS — Vite/PWA production build; 61 precache entries |
| `server/npm.cmd run build` | PASS — Prisma client generation and TypeScript build |
| root `npm.cmd audit --audit-level=low` | PASS — 0 vulnerabilities |
| server `npm.cmd audit --audit-level=low` | PASS — 0 vulnerabilities |

The server test warning that VAPID keys are not set is expected in the isolated local test environment and did not fail a test.

## Browser Gemini path check

- The tracked `.env` contains no `VITE_GEMINI_API_KEY`, `GEMINI_API_KEY`, or `API_KEY` variable name.
- `services/geminiService.ts` has no tracked import or caller outside that file at the candidate commit.
- The fresh production `dist` contains no `gemini-3-flash-preview`, `generativelanguage.googleapis.com`, `GoogleGenAI`, or `generateSurveyFromTopic` marker.
- Conclusion: the dormant module is tree-shaken from this build and no Gemini credential is present in the candidate build evidence.

## Limits

These checks do not substitute for the qualified independent human penetration test and retest required by audit point 26. The founder explicitly accepted that residual risk for this one production release attempt; the missing assessment remains open and is not recorded as PASS.

## Production release evidence

- GitHub `main` was fast-forwarded from `d89452a94d020d9a31482100779989615142a54a` to the exact candidate `0a95d10cdf96fd3b3e85ad7c42b2ac3f4b72d71c`.
- Render manual deploy `dep-das24rh7lnhs73fai08g` checked out the exact candidate and reached `Deploy succeeded | Live`.
- Render detected 20 migrations and successfully applied the 10 migrations that were pending in production, including the authentication, account settings, guest proof, demographic, media cleanup, identity/vote integrity, email case-folding, deletion journal, OTP hash-version and split media-fence migrations. No destructive reset or data-loss command was used.
- Media storage provisioning completed successfully during the release build.
- `TRUST_PROXY_HOPS` was explicitly set to `1` after the first live-log check exposed an Express proxy warning. Environment deploy `dep-das2b0t9fdbs73biiqsg` restarted the same candidate successfully. Subsequent health requests did not reproduce the proxy warning.
- Render was returned to branch `main` and the normal build command `cd server && npm ci && npm run build` after migrations completed.
- GitHub deployment `6683533145` records the Vercel Production deployment for the exact candidate as `success`.
- The production HTML at `https://socialinsightapp.com` loads `/assets/index-Cv9APc5h.js`, which exactly matches the fresh local build artifact for the candidate.

## Production smoke and monitoring

| Check | Result |
|---|---|
| `GET https://socialinsight-api.onrender.com/api/health` | PASS — 200; database connected, migrations ok, media storage configured |
| unauthenticated `GET /api/users/me` | PASS — 401 |
| untrusted-origin CORS preflight | PASS — response did not echo or authorize the untrusted origin |
| `GET https://socialinsightapp.com` | PASS — 200; Opiniup UI rendered with live feed data |
| web manifest and service worker | PASS — both returned 200 with expected content types |
| transport security header | PASS — HSTS present on the frontend response |
| Render post-release logs | PASS WITH FIX — initial trust-proxy warning corrected; replacement instance started cleanly and served repeated 200 health checks |

`opiniup.com` is not currently a working Vercel alias: its DNS resolves to `198.54.117.242` and HTTPS connections are refused. `socialinsightapp.com` is the verified working production frontend for this release. Correcting the `opiniup.com` DNS records remains an external domain task.
