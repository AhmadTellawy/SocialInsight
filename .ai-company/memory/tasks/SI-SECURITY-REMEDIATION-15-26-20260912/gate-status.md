# Gate status

| Gate | Status | Evidence or blocker |
|---|---|---|
| Scope and authority | PASSED | Founder authorization and A03 receipt are recorded in `decisions/` |
| Baseline and source quality | PASSED | Production revision and divergent history were inspected; current production fixes were merged |
| Architecture and independent code review | PASSED | E03 PASS on `2062cab`; preview-to-production coupling was found, fixed and re-reviewed |
| Local quality | PASSED | E01 accepted 446 server, 129 frontend and 54 browser tests plus both builds on the implementation snapshot |
| Local security/privacy controls | PASSED WITH RELEASE LIMITATION | Negative authorization, privacy, session, OTP, media, Socket and outage tests passed |
| Data migration | PASSED LOCALLY | Fresh 20-migration deploy plus OTP/media PostgreSQL rehearsal passed |
| Dependency security | PASSED | Both npm audit trees report 0 vulnerabilities |
| Repository governance validator | BLOCKED | 655 checks passed; one unrelated task-staging root-drift utility contract failed |
| External penetration test | BLOCKED — RISK ACCEPTED FOR ONE RELEASE | Qualified independent human test/retest required by audit point 26 is unavailable; founder instructed deployment without it after disclosure |
| Representative staging | WAIVED FOR ONE RELEASE | Founder instructed direct production deployment because current users and data are experimental; this is an exception record, not a staging PASS |
| Production release | EXECUTED UNDER FOUNDER EXCEPTION | Exact candidate `0a95d10` is live on Render and Vercel; the ordinary release gate remained blocked and was not represented as approved |
| Production verification and monitoring | PASSED | Render health, migrations, storage, auth rejection, CORS, frontend/PWA and post-release logs verified; trust-proxy warning corrected and reverified |
| Primary domain alias | OPEN | `socialinsightapp.com` is live; `opiniup.com` still resolves outside Vercel and refuses HTTPS |

Release outcome: `DEPLOYED_UNDER_EXPLICIT_FOUNDER_RISK_ACCEPTANCE`. This records what occurred and does not convert the missing audit-point-26 human penetration test into PASS or security certification.
