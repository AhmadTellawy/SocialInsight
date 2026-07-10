# socialinsight Baseline Audit Summary

This summary condenses the comprehensive read-only baseline audit completed for socialinsight. It preserves the distinction between confirmed static evidence, inference, and findings that still require runtime, browser, database, or live-environment verification.

No runtime server execution, browser verification, dependency installation, deployment, or database action was performed during the baseline audit.

## 1. Confirmed Technology Stack

Frontend confirmed:

- React 19, TypeScript, Vite, React Router, Tailwind via CDN, i18next/react-i18next, lucide-react, Socket.IO client, html2canvas, and Vite PWA.
- Evidence: `C:\Users\ABC\Downloads\socialinsight\package.json`, `C:\Users\ABC\Downloads\socialinsight\vite.config.ts`, `C:\Users\ABC\Downloads\socialinsight\index.tsx`, `C:\Users\ABC\Downloads\socialinsight\index.html`, `C:\Users\ABC\Downloads\socialinsight\tsconfig.json`.

Backend confirmed:

- Node.js, TypeScript, Express, Prisma, PostgreSQL, Socket.IO, web-push, node-cron, helmet, cors, rate limiting, hpp, and zod.
- Evidence: `C:\Users\ABC\Downloads\socialinsight\server\package.json`, `C:\Users\ABC\Downloads\socialinsight\server\src\app.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\prisma.ts`, `C:\Users\ABC\Downloads\socialinsight\server\tsconfig.json`.

Database confirmed:

- Prisma datasource provider is PostgreSQL.
- Evidence: `C:\Users\ABC\Downloads\socialinsight\server\prisma\schema.prisma`, `C:\Users\ABC\Downloads\socialinsight\server\prisma.config.ts`, `C:\Users\ABC\Downloads\socialinsight\server\prisma\migrations\20260607000000_init\migration.sql`.

## 2. Architecture Overview

Confirmed repository structure:

- `C:\Users\ABC\Downloads\socialinsight\components`: frontend screens, modals, cards, group views, search, notifications, and settings.
- `C:\Users\ABC\Downloads\socialinsight\hooks`: frontend state and feature hooks.
- `C:\Users\ABC\Downloads\socialinsight\services`: active frontend API and auth service code.
- `C:\Users\ABC\Downloads\socialinsight\utils`: frontend utilities, analytics, translation helpers, and validation helpers.
- `C:\Users\ABC\Downloads\socialinsight\server`: backend API, routes, controllers, services, Prisma schema, migrations, and scripts.
- `C:\Users\ABC\Downloads\socialinsight\public`: static assets, PWA icons, and push service worker.

Inference:

- The active frontend entry appears to be root-level `C:\Users\ABC\Downloads\socialinsight\index.tsx` and `C:\Users\ABC\Downloads\socialinsight\App.tsx`, because `C:\Users\ABC\Downloads\socialinsight\index.html` references `/index.tsx`.

## 3. Frontend Overview

Confirmed:

- The active frontend API client is `C:\Users\ABC\Downloads\socialinsight\services\api.ts`.
- A second API client exists at `C:\Users\ABC\Downloads\socialinsight\src\services\api.ts` and appears stale or alternate based on endpoint differences.
- Large frontend hotspots include `C:\Users\ABC\Downloads\socialinsight\App.tsx`, `C:\Users\ABC\Downloads\socialinsight\components\SurveyCard.tsx`, `C:\Users\ABC\Downloads\socialinsight\components\CreateSurveyModal.tsx`, and `C:\Users\ABC\Downloads\socialinsight\components\CreatePollScreen.tsx`.

Inference:

- Frontend maintainability risk is elevated because routing, feed state, voting, analytics, comments, share/report/delete, and creation workflows are concentrated in large components.

## 4. Backend Overview

Confirmed:

- Backend route registration is centralized in `C:\Users\ABC\Downloads\socialinsight\server\src\app.ts`.
- Large backend hotspots include `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\postController.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\groupController.ts`, and `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\userController.ts`.
- Service boundaries exist in `C:\Users\ABC\Downloads\socialinsight\server\src\services\privacyService.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\services\groupPermissionService.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\services\notificationService.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\services\pushService.ts`, and `C:\Users\ABC\Downloads\socialinsight\server\src\services\socketService.ts`.

Inference:

- Backend architecture is functional but controller-heavy; authorization, mapping, counters, notifications, and business rules remain mixed into controllers.

## 5. Database Overview

Confirmed:

- Prisma models cover users, demographics, follows, groups, group members, posts, sections, questions, options, responses, answers, comments, notification settings, notifications, likes, OTP codes, pending registrations, saved posts, hidden posts, reports, interaction events, comment likes, user blocks, post views, and push subscriptions.
- Evidence: `C:\Users\ABC\Downloads\socialinsight\server\prisma\schema.prisma`.
- Database migrations exist under `C:\Users\ABC\Downloads\socialinsight\server\prisma\migrations`.

Confirmed risk:

- `C:\Users\ABC\Downloads\socialinsight\server\package.json` includes a `render-build` script using `prisma db push --accept-data-loss`.

Inference:

- Missing DB-level uniqueness around responses may allow duplicate voting records under concurrency unless prevented elsewhere.

## 6. Authentication And Authorization Overview

Confirmed:

- Authentication uses JWT Bearer tokens and bcrypt password hashing.
- Evidence: `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\authController.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\middleware\authMiddleware.ts`, `C:\Users\ABC\Downloads\socialinsight\services\api.ts`.
- Authorization helpers include `requireAuth`, `optionalAuth`, privacy checks, and group permission services.

Major confirmed concern:

- Several read paths use query/body identity such as `userId` or `currentUserId` when no verified token is present.
- Evidence: `C:\Users\ABC\Downloads\socialinsight\server\src\middleware\authMiddleware.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\postController.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\userController.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\followController.ts`.

Runtime verification still required:

- Exact exploitability and affected data exposure must be verified in a controlled environment.

## 7. Realtime And Notification Overview

Confirmed:

- Socket.IO is initialized in `C:\Users\ABC\Downloads\socialinsight\server\src\services\socketService.ts`.
- Client socket connection code exists in `C:\Users\ABC\Downloads\socialinsight\components\SocketContext.tsx`.
- Notification creation and realtime emission are handled by `C:\Users\ABC\Downloads\socialinsight\server\src\services\notificationService.ts`.
- Web Push support exists in `C:\Users\ABC\Downloads\socialinsight\server\src\services\pushService.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\routes\pushRoutes.ts`, and `C:\Users\ABC\Downloads\socialinsight\public\sw-push.js`.

Major confirmed concern:

- Socket room membership is based on handshake query `userId` without confirmed JWT verification in `C:\Users\ABC\Downloads\socialinsight\server\src\services\socketService.ts`.

## 8. PWA Overview

Confirmed:

- PWA is configured through Vite PWA in `C:\Users\ABC\Downloads\socialinsight\vite.config.ts`.
- Service worker registration exists in `C:\Users\ABC\Downloads\socialinsight\index.tsx`.
- Push service worker code exists at `C:\Users\ABC\Downloads\socialinsight\public\sw-push.js`.
- PWA icons exist under `C:\Users\ABC\Downloads\socialinsight\public`.

Not verified:

- Installability, offline behavior, notification click routing, and browser permission flow.

## 9. Testing Maturity

Confirmed:

- No formal test framework dependency or configuration was confirmed in `C:\Users\ABC\Downloads\socialinsight\package.json` or `C:\Users\ABC\Downloads\socialinsight\server\package.json`.
- Backend `test` script is a placeholder in `C:\Users\ABC\Downloads\socialinsight\server\package.json`.
- Ad-hoc scripts exist, including `C:\Users\ABC\Downloads\socialinsight\test_crash.js`, `C:\Users\ABC\Downloads\socialinsight\test_local.cjs`, and `C:\Users\ABC\Downloads\socialinsight\server\scripts\testGroupSecurity.ts`.

Inference:

- The repository does not yet have a reliable automated safety net for broad autonomous changes.

## 10. Major Confirmed Findings

- High: read endpoints can trust caller-supplied identity. Evidence: `C:\Users\ABC\Downloads\socialinsight\server\src\middleware\authMiddleware.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\postController.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\userController.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\followController.ts`.
- High: registration completion payload mismatch. Evidence: `C:\Users\ABC\Downloads\socialinsight\services\api.ts`, `C:\Users\ABC\Downloads\socialinsight\components\SignUpFlow.tsx`, `C:\Users\ABC\Downloads\socialinsight\components\SignUpSteps.tsx`, `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\authController.ts`.
- High: Socket.IO notification room identity is not confirmed authenticated. Evidence: `C:\Users\ABC\Downloads\socialinsight\server\src\services\socketService.ts`, `C:\Users\ABC\Downloads\socialinsight\components\SocketContext.tsx`.
- High: search appears to lack centralized privacy filtering. Evidence: `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\searchController.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\services\privacyService.ts`.
- Medium/high: analytics ingestion appears spoofable. Evidence: `C:\Users\ABC\Downloads\socialinsight\server\src\routes\analyticsRoutes.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\analyticsController.ts`, `C:\Users\ABC\Downloads\socialinsight\utils\analytics.ts`.
- High: deployment script includes destructive DB sync behavior. Evidence: `C:\Users\ABC\Downloads\socialinsight\server\package.json`.
- Medium: response uniqueness and vote counter integrity appear underprotected at DB level. Evidence: `C:\Users\ABC\Downloads\socialinsight\server\prisma\schema.prisma`, `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\postController.ts`.
- Medium: OTP defaults/logging and token lifecycle need security review. Evidence: `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\authController.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\otpController.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\middleware\authMiddleware.ts`.
- Medium: base64 image upload and processing need memory and payload review. Evidence: `C:\Users\ABC\Downloads\socialinsight\server\src\app.ts`, `C:\Users\ABC\Downloads\socialinsight\server\src\utils\imageProcessor.ts`.

## 11. Suspected Findings Requiring Runtime Verification

- Whether query identity spoofing exposes specific private resources in a running environment.
- Whether private, follower-only, or group-scoped posts appear in search results with seeded data.
- Whether concurrent voting can produce duplicate responses or inaccurate counters.
- Whether large base64 media payloads can cause memory pressure or request failures.
- Whether PWA install, offline, update, and notification click behavior work in target browsers.
- Whether responsive, RTL, Arabic, and mobile layouts have visible defects.
- Whether production database schema exactly matches the checked-in Prisma migrations.

## 12. Maintainability Concerns

Confirmed:

- Very large files concentrate important behavior: `C:\Users\ABC\Downloads\socialinsight\server\src\controllers\postController.ts`, `C:\Users\ABC\Downloads\socialinsight\components\SurveyCard.tsx`, `C:\Users\ABC\Downloads\socialinsight\components\CreateSurveyModal.tsx`, `C:\Users\ABC\Downloads\socialinsight\App.tsx`.
- Legacy, temporary, or ad-hoc artifacts are present, including `C:\Users\ABC\Downloads\socialinsight\SurveyCard.tsx.orig`, `C:\Users\ABC\Downloads\socialinsight\components\TrendsScreen.tsx-fix-temp`, and root-level `fix_*.cjs` or `update_*.cjs` scripts.

Inference:

- Future changes should start with explicit scope and ownership boundaries to avoid editing stale or generated artifacts.

## 13. Agent Readiness Score

Readiness for autonomous Product & Engineering Agent work: 38/100.

Reasoning:

- Core auth/privacy and registration concerns remain unresolved.
- Runtime and browser verification were not completed.
- Formal automated tests are not in place.
- Deployment/database safeguards need tightening.
- Several large files increase regression risk.

## 14. Current Blockers

- Fix registration completion contract before treating signup as reliable.
- Remove trust in caller-supplied identity for protected read paths.
- Authenticate realtime socket identity.
- Apply privacy rules consistently to search and related read surfaces.
- Replace destructive deployment DB sync behavior with reviewed migrations.
- Establish automated test coverage for auth, privacy, groups, search, voting, notifications, and registration.

## 15. Recommended Sequencing

1. Stabilize governance and review standards.
2. Add a minimal test strategy and safe verification process.
3. Fix confirmed auth/privacy and registration blockers.
4. Add database constraints and migration discipline after explicit schema review.
5. Add integration and browser tests around critical user journeys.
6. Refactor large frontend and backend hotspots only after tests protect current behavior.
7. Review PWA, RTL/LTR, Arabic/English, and mobile UX with browser evidence.

