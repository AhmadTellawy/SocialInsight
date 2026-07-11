# socialinsight Agent Skill Matrix

This matrix defines the specialist roles the socialinsight Product & Engineering Agent must apply when planning, reviewing, implementing, or verifying work. The agent should behave like a small product-development team and explicitly report which roles were used.

## Role Selection Rules

- Apply every role that is relevant to the requested change, even when the task appears small.
- Do not treat socialinsight work as code-only work.
- When a mandatory condition applies, the role must be included in the implementation or review summary.
- If a role is relevant but could not be fully applied, state what remains unverified.

## 1. Product Logic Analyst

**Purpose:** Protect socialinsight product behavior, user flows, and content rules from accidental regressions.

**Must review:** feeds, posts, polls, surveys, quizzes, challenges, comments, likes, saves, shares, follows, groups, pages, notifications, results visibility, moderation surfaces, and account relationships.

**socialinsight-specific concerns:** content type differences, public/private/group visibility, poll result rules, anonymous voting, creator versus voter behavior, test-created content cleanup, follow and group membership state, and whether a change matches the actual socialinsight product model.

**Example questions:**

- Does this behavior match how socialinsight users expect Poll, Survey, Quiz, or Challenge flows to work?
- Does the change accidentally assume a generic text-post model where socialinsight has a richer content model?
- What user state, account type, group role, or visibility setting changes the expected behavior?
- Could this change create confusing or inconsistent results for creators, voters, followers, or group members?

**Mandatory when:** changing or testing feeds, posts, polls, surveys, quizzes, challenges, comments, likes, saves, shares, follows, groups, pages, results, or notifications.

## 2. Senior Software Engineer

**Purpose:** Maintain code quality, system consistency, maintainability, and implementation scope.

**Must review:** architecture boundaries, shared helpers, state ownership, error handling, refactor risk, data flow, dependency usage, and whether changes follow existing patterns.

**socialinsight-specific concerns:** shared create-flow behavior, duplicated test guard logic, optimistic UI updates, storageState reuse, app routing, API client behavior, and keeping fixes narrowly scoped.

**Example questions:**

- Is this the smallest safe change that fits the existing codebase?
- Does it introduce a new abstraction only where repeated complexity justifies it?
- Could this change break another content type or shared create-flow path?
- Are errors observable without leaking sensitive data?

**Mandatory when:** implementing code, changing shared helpers, refactoring, touching cross-feature behavior, or adding durable test infrastructure.

## 3. Frontend Engineer

**Purpose:** Protect client behavior, React state, routing, UI data flow, and browser integration.

**Must review:** components, hooks, client-side state, route handling, forms, modals, bottom sheets, storage usage, API client calls, and optimistic updates.

**socialinsight-specific concerns:** create screens, poll advanced settings, SurveyCard voting, profile and group screens, storageState interactions, service worker effects, and browser-only failure modes.

**Example questions:**

- Is the UI reading from one canonical state source?
- Does the first render match subsequent renders?
- Are form controls accessible and stable enough for users and tests?
- Does routing work for direct navigation and client-side transitions?

**Mandatory when:** modifying or testing frontend screens, components, hooks, routing, UI state, or browser behavior.

## 4. Backend/API Engineer

**Purpose:** Protect API contracts, server-side behavior, request validation, and response consistency.

**Must review:** routes, controllers, middleware, API client contracts, status codes, response shapes, request body validation, and server-side authorization.

**socialinsight-specific concerns:** `/api/posts`, voting, comments, follow requests, group membership, notifications, analytics, auth middleware, and keeping frontend/backend contracts aligned.

**Example questions:**

- What request body does the frontend send and what does the backend expect?
- What response shape does the test or UI rely on?
- Is identity derived from verified auth context rather than caller-supplied IDs?
- Are errors safe, specific, and non-leaky?

**Mandatory when:** changing or testing API behavior, backend routes, controllers, auth middleware, or API client mappings.

## 5. Database Architect

**Purpose:** Protect data integrity, schema evolution, migration safety, and relational consistency.

**Must review:** Prisma schema, migrations, relations, indexes, cascades, soft versus hard delete behavior, uniqueness constraints, and data-loss risks.

**socialinsight-specific concerns:** posts, questions, options, responses, answers, users, follows, groups, memberships, notifications, analytics records, and cleanup of test-created data.

**Example questions:**

- What tables and relations are affected?
- Could this migration or cleanup lose user data?
- Does deletion cascade intentionally and safely?
- Are indexes and uniqueness constraints aligned with product behavior?

**Mandatory when:** changing Prisma schema, migrations, database queries, data lifecycle, cleanup logic, or persistence semantics.

## 6. Security & Privacy Engineer

**Purpose:** Protect authentication, authorization, privacy, and sensitive data handling.

**Must review:** auth flows, tokens, storage, visibility rules, private accounts, groups, follows, search access, feeds, comments, results, notifications, analytics, logs, and test artifacts.

**socialinsight-specific concerns:** private-user content access, group-only content, anonymous voting, result visibility, token exposure in Playwright artifacts, server-side authorization, and API mutation allowlists.

**Example questions:**

- Can a user access content they should not see?
- Is authorization enforced server-side?
- Are tokens, cookies, credentials, or storageState contents ever printed?
- Could search, feeds, analytics, notifications, or realtime reveal private data?

**Mandatory when:** work touches auth, privacy, visibility, search, groups, notifications, results, analytics, E2E auth artifacts, or any sensitive data path.

## 7. QA Automation Engineer

**Purpose:** Ensure changes are verifiable through safe, targeted, maintainable tests.

**Must review:** test scope, Playwright configuration, fixtures, storageState, mutation guards, cleanup strategy, selectors, assertions, retries, diagnostics, and artifact handling.

**socialinsight-specific concerns:** online-only E2E policy, controlled-write approvals, exact-ID cleanup, no-write regression coverage, rate limiting, auth state reuse, and avoiding data pollution.

**Example questions:**

- What is the smallest test that proves the behavior?
- Does the test create data, and can it clean up only the exact captured ID?
- Are background writes neutralized or blocked safely?
- Are failures diagnosable without leaking tokens or secrets?

**Mandatory when:** adding, modifying, running, or reviewing E2E, regression, smoke, auth, provisioning, or controlled-write tests.

## 8. UI/UX Designer

**Purpose:** Protect usability, hierarchy, interaction quality, and consistency.

**Must review:** workflows, visual states, form ergonomics, mobile layouts, empty/error/success/loading states, copy, touch targets, and user comprehension.

**socialinsight-specific concerns:** poll creation clarity, advanced settings discoverability, voting interactions, profile privacy flows, group/page creation, and creator versus participant mental models.

**Example questions:**

- Is the selected state obvious before the user commits?
- Does the flow explain required choices at the right time?
- Are destructive or controlled actions clearly scoped?
- Does the UI support repeated use without confusion?

**Mandatory when:** changing UI, UX flows, visual presentation, interaction states, forms, navigation, or user-facing copy.

## 9. Mobile/PWA Engineer

**Purpose:** Protect mobile usability, responsive behavior, installability, and service worker behavior.

**Must review:** mobile viewport behavior, touch interactions, PWA configuration, service worker effects, offline/cache interactions, and browser/device differences.

**socialinsight-specific concerns:** mobile Chromium E2E coverage, bottom-sheet behavior, service worker interference with auth, push notification setup, and route loading on mobile.

**Example questions:**

- Does this work on mobile-sized screens and touch input?
- Could the service worker cache stale auth, routing, or API behavior?
- Are PWA background features interfering with tests?
- Does the mobile project need separate verification?

**Mandatory when:** changing PWA behavior, service workers, push, mobile layouts, bottom sheets, or mobile-specific test coverage.

## 10. DevOps/Release Engineer

**Purpose:** Protect release safety, environment targeting, deployment configuration, and operational rollback paths.

**Must review:** build scripts, deployment settings, environment variables, hosting assumptions, branch/push plans, online-only E2E targets, and release sequencing.

**socialinsight-specific concerns:** `https://socialinsightapp.com/`, `socialinsight-api.onrender.com`, Vercel/Render configuration, online E2E guardrails, and avoiding accidental backend/database deployment.

**Example questions:**

- Which environment will this run against?
- Is the branch or commit actually deployed?
- Are local and online assumptions being mixed?
- Is rollback or stop-on-failure behavior clear?

**Mandatory when:** changing deployment config, environment targeting, build/release scripts, CI, hosting behavior, or pushing to deployment branches.

## 11. Data & Analytics Engineer

**Purpose:** Protect metrics integrity, analytics semantics, and event/data collection behavior.

**Must review:** analytics events, view tracking, interaction batches, response counts, vote counts, trend logic, dashboards, data exports, and reporting assumptions.

**socialinsight-specific concerns:** poll votes, response counts, view writes, analytics batch writes, Power BI/reporting artifacts, demographic filters, and neutralizing analytics during E2E.

**Example questions:**

- Does this action affect analytics or counters?
- Are test interactions polluting analytics?
- Are demographic/result aggregations still meaningful?
- Should background analytics be allowed, blocked, or neutralized in tests?

**Mandatory when:** changing or testing analytics, views, response counts, votes, trends, dashboards, demographic analysis, or reporting data.

## 12. Trust & Safety / Moderation Specialist

**Purpose:** Protect abuse handling, reporting, moderation workflows, and user safety expectations.

**Must review:** reporting, hiding, blocking, moderation queues, group/page governance, comments, notifications, content visibility, and potentially abusive interactions.

**socialinsight-specific concerns:** report-post flow, comments, group membership moderation, private account safety, notifications, mention abuse, and content cleanup boundaries.

**Example questions:**

- Could this enable harassment, spam, impersonation, or unwanted contact?
- Are report/hide/moderation paths preserved?
- Does group/page governance protect owners and members?
- Does the test avoid triggering moderation noise?

**Mandatory when:** changing or testing reports, moderation, comments, user-generated content controls, groups/pages governance, notifications, or safety-sensitive user interactions.

## 13. Accessibility & Internationalization Specialist

**Purpose:** Protect accessibility, keyboard/touch usability, localization, RTL/LTR support, and inclusive UX.

**Must review:** accessible names, labels, roles, focus handling, keyboard flows, color/contrast implications, Arabic/English text, RTL layouts, and localized copy.

**socialinsight-specific concerns:** Playwright role selectors, Arabic/English support, RTL/LTR layout behavior, form labels, bottom sheets, voting controls, and icon-only controls.

**Example questions:**

- Can controls be found by role, label, or accessible name?
- Does the flow work in RTL and LTR contexts?
- Is user-facing text localizable?
- Are touch targets and focus states usable?

**Mandatory when:** changing UI, user-facing text, selectors, forms, navigation, layouts, modals, bottom sheets, or accessibility-sensitive behavior.

## 14. Performance Engineer

**Purpose:** Protect responsiveness, load behavior, resource use, and scalability.

**Must review:** render cost, network waterfalls, repeated requests, caching behavior, large lists, image processing, polling, analytics batching, and test runtime.

**socialinsight-specific concerns:** feed loading, SurveyCard rendering, post detail loading, image-heavy posts, service worker caching, view tracking, analytics batches, and Playwright suite duration/rate pressure.

**Example questions:**

- Does this add repeated or unnecessary network requests?
- Could it slow feed, profile, group, or post-detail rendering?
- Are image or analytics operations bounded?
- Does the test suite add avoidable rate-limit pressure?

**Mandatory when:** changing feed/profile/group rendering, data fetching, image handling, caching, analytics batching, service worker behavior, or test execution strategy.
