# socialinsight Process / Feature Deep Audit Protocol

This protocol defines the repeatable audit path the socialinsight Product & Engineering Agent must follow whenever the user asks to inspect, audit, review, evaluate, or improve a specific product process or feature.

Example audited processes include registration, login, logout, OTP, poll creation, survey creation, quiz creation, challenge creation, voting, follow requests, private accounts, groups, pages, search, notifications, comments, likes, saved posts, analytics, or results visibility.

The agent must use this protocol before recommending or implementing major product-flow changes.

## Core Rules

- Do not jump directly to implementation unless the user explicitly asks to implement.
- Produce evidence-first findings with repository paths and verification level.
- Separate confirmed behavior, static-code inference, browser evidence, and unresolved assumptions.
- Apply the relevant specialist roles from `docs/agent/skill-matrix.md`.
- Number every finding with a process-specific prefix, such as `REG-01`, `LOGIN-01`, `POLL-01`, `VOTE-01`, or `GROUP-01`.
- Wait for the user to approve specific finding IDs before implementation.
- Do not implement unapproved findings.
- For online controlled-write verification, use exact captured IDs for cleanup and never bulk delete or delete by title.

## 1. Scope Definition

Define the audit boundaries before reviewing code.

Required coverage:

- Process or feature name.
- What is included.
- What is excluded.
- User roles involved, such as guest, authenticated user, creator, voter, follower, non-follower, private user, group owner, group member, page owner, admin, or moderator.
- Preconditions, such as auth state, account state, group membership, visibility settings, existing content, or feature flags.
- Success criteria from the user and product perspective.
- Verification levels allowed for the task, such as static review, browser review, no-write E2E, controlled-write E2E, or manual verification.

Questions to answer:

- Which exact user journey is being audited?
- Which actors can start, complete, cancel, or be affected by the process?
- What outcomes are intentionally out of scope?
- What would count as a successful process?

## 2. Current Flow Mapping

Map how the process works today.

Required coverage:

- Current user journey.
- Current frontend flow.
- Current backend/API flow.
- Current database/data model flow.
- Current authentication assumptions.
- Current authorization assumptions.
- Current validation rules.
- Current error handling.
- Current loading, empty, and success states.
- Current edge cases and fallback behavior.
- Current side effects, such as notifications, analytics, sockets, push, email, OTP, or view tracking.

Evidence expectations:

- Cite files, components, routes, controllers, services, schema, tests, and docs.
- Label static evidence separately from runtime or browser evidence.
- Do not claim browser-visible behavior without browser verification.

## 3. Target / Ideal Flow

Define how the process should work.

Required coverage:

- Product-level ideal user journey.
- Technical ideal behavior.
- Expected frontend state transitions.
- Expected backend/API contract.
- Expected database state changes.
- Expected security and privacy behavior.
- Expected analytics behavior where relevant.
- Expected notifications, realtime, push, email, or OTP behavior where relevant.
- Expected cleanup or rollback behavior for tests and failed flows.

Questions to answer:

- What should a correct user experience feel like?
- What should the system accept, reject, persist, notify, and expose?
- Which user roles should see different behavior?
- Which state transitions must be impossible?

## 4. Code Architecture Review

Map the implementation surface.

Required coverage:

- Frontend files, components, hooks, routes, and state.
- Service/API client functions.
- Backend routes, controllers, services, middleware, and utilities.
- Database models, tables, relations, and migrations.
- Shared types and contracts.
- External services and integrations.
- Side effects such as notifications, analytics, sockets, push, email, OTP, image processing, and service workers.
- Existing tests, fixtures, helpers, and documented standards.

Output should include an architecture map with file paths and a short purpose for each path.

## 5. Product Logic Review

Review the business rules and product model.

Required coverage:

- Business/product rules.
- Visibility rules.
- Ownership rules.
- Permission rules.
- State transitions.
- Role-specific behavior.
- Public/private/group/page behavior where applicable.
- Content-type differences across Poll, Survey, Quiz, and Challenge.
- Creator versus participant behavior.
- Guest versus authenticated behavior.
- Draft, published, pending, deleted, expired, and rejected states where applicable.

Questions to answer:

- Does the implementation match the actual socialinsight product model?
- Are product terms used consistently?
- Are role and visibility rules applied at every entry point?
- Are edge cases defined or accidental?

## 6. Frontend Review

Review the client-side experience and behavior.

Required coverage:

- Forms and controls.
- State management and derived state.
- Client validation.
- Server validation display.
- Loading states.
- Error states.
- Empty states.
- Success feedback.
- Double-submit protection.
- Draft or retry behavior.
- Route behavior and direct navigation.
- Mobile behavior.
- RTL/LTR behavior.
- Accessibility basics.
- Service worker or PWA interaction where relevant.

Questions to answer:

- Can the user understand what to do next?
- Are first render and later renders consistent?
- Can a user submit twice or create duplicate data?
- Are errors recoverable and specific?

## 7. Backend/API Review

Review server behavior and API contracts.

Required coverage:

- API request body and query contract.
- API response shape.
- Input validation.
- Server-side authorization.
- Server-side ownership checks.
- Error handling.
- HTTP status codes.
- Idempotency.
- Rate limiting.
- Abuse controls.
- Response shape consistency.
- Trust boundaries between client-supplied IDs and verified auth identity.
- Backward compatibility.

Questions to answer:

- Does the backend enforce rules that the frontend also hints at?
- Are all mutations authenticated and authorized?
- Does the API return enough safe information for the UI and tests?
- Are sensitive errors or data leaked?

## 8. Database Review

Review persistence and data integrity.

Required coverage:

- Schema design.
- Constraints.
- Indexes.
- Relations.
- Transactions.
- Cascades.
- Soft delete and hard delete behavior.
- Orphan record risks.
- Data consistency.
- Migration risk.
- Cleanup behavior for test-created data.
- Counter correctness, such as votes, responses, likes, comments, followers, views, and shares.

Questions to answer:

- Are writes transactional where they need to be?
- Can partial failure leave inconsistent data?
- Are deletes safe, scoped, and reversible where required?
- Could future migrations lose or corrupt data?

## 9. Security & Privacy Review

Review user protection, privacy boundaries, and sensitive-data handling.

Required coverage:

- Authentication.
- Authorization.
- Token handling.
- Session and storage behavior.
- User ID trust boundaries.
- Private data exposure.
- Search visibility.
- Feed visibility.
- Group/page visibility.
- Results visibility.
- OTP/password risks where applicable.
- Rate-limit and abuse risks.
- Logging and secret exposure risks.
- E2E artifact exposure risks.

Mandatory for:

- registration
- login
- auth
- privacy
- visibility
- search
- groups
- pages
- notifications
- voting
- results
- user relationships

Questions to answer:

- Can a user act as another user by submitting an ID?
- Can private or group-only data leak through search, feeds, detail pages, notifications, analytics, or realtime?
- Are tokens, credentials, cookies, localStorage, sessionStorage, or storageState values ever printed?
- Are auth and authorization enforced on the server?

## 10. UI/UX Review

Review usability and product experience.

Required coverage:

- Visual hierarchy.
- Mobile-first layout.
- Input clarity.
- Button states.
- Disabled states.
- Error wording.
- Success feedback.
- Navigation.
- Cognitive load.
- Consistency with social app patterns.
- Consistency across related socialinsight screens.
- Touch target quality.
- Modal, sheet, and overlay behavior.

Questions to answer:

- Does the user know what happened after each action?
- Are primary and secondary actions clear?
- Does the flow avoid surprising state changes?
- Are destructive or controlled actions scoped and understandable?

## 11. Accessibility & Internationalization Review

Review inclusive access and language support.

Required coverage:

- Arabic and English support.
- RTL and LTR behavior.
- Labels and accessible names.
- Keyboard navigation where applicable.
- Screen-reader-friendly naming.
- Focus management.
- Contrast concerns.
- Translation consistency.
- Avoiding text that cannot be localized.
- Playwright selector reliability through roles and labels where possible.

Questions to answer:

- Are controls discoverable by role, label, or accessible name?
- Does layout remain coherent in RTL and LTR?
- Are messages and labels translatable?
- Can keyboard and assistive technology users complete the flow?

## 12. Data & Analytics Review

Review tracking, reporting, and data quality.

Required coverage:

- Events that should exist.
- Events that should not exist.
- Sensitive data that must not be included.
- View tracking.
- Interaction tracking.
- Vote and response counters.
- Reporting consistency.
- Test-data pollution risk.
- Dashboard or export implications.
- Analytics neutralization in E2E where needed.

Questions to answer:

- What analytics should be emitted for this process?
- Are test actions polluting analytics?
- Are counters updated once and only once?
- Could analytics expose private or sensitive data?

## 13. Performance Review

Review responsiveness and scalability.

Required coverage:

- API call count.
- Request waterfalls.
- Large payloads.
- Feed impact.
- Profile/group/search impact.
- N+1 query risk.
- Image/media loading.
- Client rerender risks.
- Caching and service worker behavior.
- Test runtime and rate-limit pressure.

Questions to answer:

- Does this flow add unnecessary network or render work?
- Could one user action trigger repeated backend writes?
- Are large lists, images, or analytics batches bounded?
- Could online tests create rate-limit pressure?

## 14. Trust & Safety / Abuse Review

Review abuse, moderation, and safety implications.

Required coverage:

- Spam risks.
- Fake account risks.
- Impersonation risks.
- Harassment risks.
- Reporting and blocking impact.
- Group/page abuse surfaces.
- Comment and notification abuse.
- Rate limits and friction.
- Moderation workflow implications.
- Safety of public, private, and group contexts.

Questions to answer:

- Could this flow be abused at scale?
- Does it create unwanted contact or notifications?
- Are report, hide, moderation, or block paths preserved?
- Are test actions intentionally avoiding moderation noise?

## 15. Practical Verification Plan

Define how findings should be verified safely.

Required coverage:

- No-write tests.
- Controlled-write tests.
- Manual browser checks.
- Mobile viewport checks.
- Desktop checks.
- Negative test cases.
- Cleanup requirements.
- Test account requirements.
- Exact-ID cleanup rule.
- Rate-limit risk.
- Artifact cleanup.
- Data pollution risk.
- Which checks are required before commit.

Controlled-write requirements:

- Use dedicated test accounts.
- Use `e2e_` prefixes.
- Capture created IDs before cleanup.
- Delete only the exact captured ID from the current run.
- Never bulk delete.
- Never delete by title.
- Never clean up old data without separate explicit approval.
- Never expose credentials, tokens, cookies, localStorage, sessionStorage, storageState contents, authorization headers, or sensitive request/response bodies.

## 16. Findings Register

Every finding must use this structure:

```text
ID:
Title:
Priority: P0/P1/P2/P3
Severity:
Effort:
Category:
Current behavior:
Expected behavior:
Evidence:
Impacted files/modules:
User impact:
Security/privacy impact:
Data impact:
Implementation recommendation:
Acceptance criteria:
Tests required:
Dependencies:
Safe to implement now? Yes/No
```

Priority guidance:

- `P0`: critical security, data-loss, auth bypass, production-breaking, or severe privacy issue.
- `P1`: major user-facing defect, high-risk inconsistency, or important broken flow.
- `P2`: medium-risk defect, maintainability issue, missing test, UX issue, or edge-case gap.
- `P3`: polish, cleanup, documentation, minor UX, or future optimization.

Finding categories may include:

- Product Logic
- Frontend
- Backend/API
- Database
- Security & Privacy
- UI/UX
- Accessibility & i18n
- Data & Analytics
- Performance
- Trust & Safety
- QA Automation
- DevOps/Release

## 17. Prioritized Implementation Roadmap

Group findings into:

- Must fix now
- Should fix soon
- Can improve later
- Product decision needed

For each group include:

- Finding IDs.
- Recommended implementation order.
- Risks.
- Dependencies.
- Files or modules likely to change.
- Expected testing approach.
- Whether implementation can be batched safely.
- Whether deployment or migration sequencing matters.

## 18. User Approval Gate

The agent must not implement audit findings automatically.

Before implementation:

- Ask the user to approve specific finding IDs.
- Accept approvals such as `Implement REG-01, REG-02, and REG-05`.
- Do not implement unapproved findings.
- If an approved finding depends on an unapproved finding, explain the dependency and wait for confirmation.
- Keep code changes scoped to the approved IDs.

## 19. Implementation Follow-up Rule

When the user approves selected finding IDs:

- Implement only those IDs.
- Do not implement unapproved findings.
- Explain any dependency that makes another finding necessary.
- Run relevant tests only.
- Preserve online-only and controlled-write guardrails where applicable.
- Commit only if instructed or if the user-approved workflow says to commit.
- Report exact files changed.
- Report verification results.
- Report any skipped verification and why.
- Report remaining risks and unresolved product decisions.

## 20. Required Final Output Format

Audit output must use this structure:

```text
A. Audit Result
B. Scope
C. Current Flow
D. Target / Ideal Flow
E. Architecture Map
F. Frontend Review
G. Backend/API Review
H. Database Review
I. Security & Privacy Review
J. UI/UX Review
K. Accessibility & i18n Review
L. Data & Analytics Review
M. Performance Review
N. Trust & Safety Review
O. Practical Test Results
P. Findings Register
Q. Prioritized Roadmap
R. Suggested Implementation Batches
S. Product Decisions Needed
T. Risks
U. Next Step
```

## Audit Result Classifications

Use one of:

- `PASS`: no material issues found for the requested audit scope.
- `PASS WITH CONCERNS`: issues or risks exist, but no immediate blocker was found.
- `FAIL`: critical or blocking issues exist, or the audit could not be completed safely.

## Suggested Audit Workflow

1. Confirm operating mode and scope.
2. Identify applicable specialist roles from `docs/agent/skill-matrix.md`.
3. Inspect relevant docs, tests, frontend, backend, API, database schema, and configuration.
4. Map current flow and target flow.
5. Review each required discipline section.
6. Produce numbered findings.
7. Prioritize roadmap and implementation batches.
8. Ask for approval of specific finding IDs before implementation.

## Minimum Evidence Standard

Each material claim must identify its evidence level:

- Static code evidence.
- Runtime evidence.
- Browser evidence.
- Test evidence.
- Documentation evidence.
- Inference from evidence.
- Unverified assumption.

Do not upgrade an inference into a confirmed finding without evidence.
