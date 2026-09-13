# Security remediation coverage

Implementation snapshot: `2062cabd25ff8517db96bb5e297ae36706ff1eb1` on `codex/security-remediation-release`. Current production remains `689b64dfba705f29a2a635fa5abff937745dc4fb` and does not contain this remediation.

| Area | Implemented repository behavior | Verification status |
|---|---|---|
| Registration and handle identity | Canonical registration route, normalized handles, protected aliases and case-insensitive collision checks | Local automated tests passed; provider staging pending |
| Password and credential changes | UTF-8 bcrypt 72-byte policy across registration, login, reset and password changes | Local Arabic boundary and controller tests passed |
| Email changes and reset | Versioned latest-email intent, purpose-bound OTP, generic reset failures and session revocation | Local controller/service and migration rehearsal passed |
| Sessions and realtime | Opaque cookie sessions, idle expiry, recent-auth checks, Socket origin/IP budgets and periodic revocation revalidation | HTTP, Socket and outage tests passed |
| OTP and abuse prevention | HMAC v2 OTP storage with v1 transition plus durable destination, network and operation budgets | Unit tests and real PostgreSQL v1-to-v2 rehearsal passed |
| Post authorization | Centralized audience/action rules, authenticated actor use, transaction locks and approval-state enforcement | Controller, visibility and moderation tests passed |
| Privacy and analytics | Owner-only analytics, aggregate small-cell suppression, removal of anonymous participant identifiers and count/timing oracles | Privacy negative tests passed |
| Notifications | Source visibility reauthorization at read/delivery, fail-closed outage handling and bounded pagination | Notification visibility tests passed |
| Search and input | Bounded primitive parsing with text predicates ANDed to complete audience policy | Unit and PostgreSQL integration tests passed |
| Media and uploads | Central decoding, HEIF isolation, atomic quotas, scope recomputation, split upload/storage cleanup fences and stale-public cleanup | Unit tests and PostgreSQL media lifecycle 27/27 passed |
| Database and operations | Two additive migrations, migration health checks, SQL permission preflight, no destructive Render build command, trusted proxy configuration | Fresh migration deploy and targeted rehearsal passed; provider staging pending |
| Dependencies | Exact Prisma 6.12.0 and upgraded dependency trees | Frontend and server audits report 0 vulnerabilities |
| Browser behavior | Secure session-aware fixtures, save/retry/inert interactions, repost/share recovery, RTL/LTR and follow race protection | Playwright preview 45/45 and development hook 9/9 passed |
| Independent review | E03 reviewed the production merge, session fixtures and preview isolation | PASS on implementation snapshot |
| External penetration test | No qualified external human report is available | Hard blocker for audit point 26 and production release |

The implementation portion is complete. Release closure requires the external penetration test/retest, isolated representative staging, production deployment, live smoke verification and monitoring evidence.
