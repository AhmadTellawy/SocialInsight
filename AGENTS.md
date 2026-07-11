# socialinsight Agent Governance

This file defines operating rules for all future AI-assisted work on socialinsight.

## Product Identity

- Product/application name: socialinsight.
- Repository folder name: socialinsight.
- Use the name "socialinsight" consistently in documentation, code comments, plans, reports, and user-facing summaries.
- Do not introduce alternative product names unless explicitly instructed by the user.

## Evidence-First Behavior

- Inspect before modifying.
- Cite relevant repository file paths for material conclusions.
- Separate confirmed evidence from inference.
- Do not claim runtime behavior from static code alone.
- Do not claim visual UX findings without browser evidence.
- Do not upgrade suspected issues into confirmed findings without sufficient evidence.
- Clearly state when runtime, browser, database, or live-environment verification is still required.
- When a finding is based only on source inspection, label it as static evidence.

## Mandatory Impact Analysis

Before modifying a feature, inspect all relevant layers where applicable:

- frontend
- backend
- database
- API contracts
- authentication
- authorization
- privacy
- realtime behavior
- notifications
- background jobs
- PWA behavior
- tests
- mobile behavior
- responsive behavior
- RTL/LTR behavior
- Arabic/English behavior
- deployment implications

Document which layers were inspected and which remain unverified.

## Multi-Role Review Requirement

- The agent must not approach socialinsight tasks as code-only tasks.
- Before implementation, identify which specialist roles from `docs/agent/skill-matrix.md` are relevant.
- Apply every role that materially fits the requested change, and state if a relevant role could not be fully verified.
- For auth, privacy, visibility, search, groups, notifications, or results, Security & Privacy Engineer review is mandatory.
- For UI changes, UI/UX Designer and Accessibility & Internationalization Specialist review are mandatory.
- For database/schema changes, Database Architect review is mandatory.
- For E2E or regression work, QA Automation Engineer review is mandatory.
- For deployment changes, DevOps/Release Engineer review is mandatory.
- For feed, posts, polls, comments, likes, follows, groups, or pages, Product Logic Analyst review is mandatory.
- The agent must report the roles used in every implementation summary.

## Process / Feature Deep Audit Requirement

- When the user asks to inspect, audit, review, improve, or evaluate a specific process or feature, the agent must use `docs/agent/process-audit-protocol.md`.
- The agent must not jump directly to implementation unless the user explicitly asks to implement.
- The agent must produce numbered findings with priorities.
- The agent must wait for the user to approve specific finding IDs before implementing.
- The agent must report which specialist roles were applied from `docs/agent/skill-matrix.md`.
- For registration, login, auth, privacy, visibility, search, groups, pages, notifications, voting, results, or user relationships, Security & Privacy Engineer and Product Logic Analyst reviews are mandatory.
- For UI-facing changes, UI/UX Designer and Accessibility & Internationalization Specialist reviews are mandatory.
- For backend or database changes, Backend/API Engineer and Database Architect reviews are mandatory.
- For any online test involving writes, controlled-write guardrails and exact-ID cleanup rules are mandatory.

## Natural Language Intent Routing

- The agent must infer the correct workflow from normal Arabic or English user wording using `docs/agent/natural-language-intent-router.md`.
- The user does not need to name internal docs, protocols, modes, or workflow labels.
- Natural review, audit, inspection, evaluation, or analysis wording must trigger `docs/agent/process-audit-protocol.md`.
- Natural UI, design, layout, screen, or mobile wording must trigger UI/UX review.
- Natural security, privacy, auth, permission, visibility, private account, group access, or search privacy wording must trigger Security & Privacy review.
- Natural test, browser, E2E, practical check, or online verification wording must trigger the relevant verification rules.
- Natural implementation, fix, apply, or execute wording must implement only explicitly approved findings or clearly specified work.
- The agent must state the selected workflow in its response.
- If a request combines audit and implementation, audit comes first unless the user explicitly approves implementation.
- If online writes are required, controlled-write guardrails and exact-ID cleanup are mandatory.

## Git Safety

- Never force push.
- Never rewrite history.
- Never merge automatically.
- Never delete branches automatically.
- Never reset or discard user changes automatically.
- Prefer branch-based changes.
- Report git status before major implementation work.
- Identify uncommitted and untracked files before major changes.
- Never assume the working tree is clean.
- Do not commit or push unless explicitly instructed.
- If existing user changes are present, preserve them and work around them.

## Database Safety

- Never run destructive database commands automatically.
- Never run `prisma db push --accept-data-loss`.
- Never modify production data automatically.
- Never reset the database automatically.
- Never drop tables, columns, schemas, or databases automatically.
- Schema changes require explicit review.
- Prefer reviewed Prisma migrations.
- Database migrations require impact analysis.
- Clearly identify possible data-loss risks.
- Distinguish local, test, staging, and production database actions where evidence exists.
- Do not access or modify the database unless explicitly approved for the task.

## Security And Privacy

- Never trust caller-supplied identity when verified identity is available.
- Derive authenticated identity from verified server-side authentication context.
- Authorization must be enforced server-side.
- Frontend restrictions are not sufficient authorization controls.
- Private account and content visibility rules must be checked across all access paths.
- Search, feeds, comments, followers, following, poll results, realtime events, notifications, and analytics require privacy review where applicable.
- Realtime/socket identity must be authenticated.
- Sensitive data must not be exposed in logs or reports.
- Secret values must never be displayed.
- Security findings must distinguish confirmed vulnerabilities from suspected risks.

## Operating Modes

### REVIEW_ONLY

- Inspect and analyze.
- Do not modify files.
- Do not install dependencies.
- Do not deploy.
- Do not modify databases.

### PROPOSE_ONLY

- Inspect and analyze.
- Propose changes.
- Identify affected files.
- Identify risks.
- Do not implement changes.

### IMPLEMENT_APPROVED

- Implement only explicitly approved changes.
- Do not expand scope silently.
- Run relevant checks.
- Report every changed file.
- Report remaining risks.

### VERIFY_ONLY

- Verify existing implementation.
- Do not modify application logic unless explicitly approved.
- State exactly which verification levels were completed.

Default to REVIEW_ONLY when user intent is ambiguous.

## Testing Rules

- Do not claim a fix is complete merely because code was edited.
- Run relevant available checks when permitted.
- Report missing tests.
- Report test failures honestly.
- Distinguish static verification from runtime verification.
- Distinguish a successful build from successful functional testing.
- Distinguish browser testing from code inspection.
- Do not hide flaky or inconsistent test behavior.
- Identify untested critical flows.

## Online-Only Playwright E2E Policy

- During the current phase, Playwright E2E tests must target only the approved online URL: `https://socialinsightapp.com/`.
- Localhost, local frontend, and local backend E2E targets are not allowed during this phase.
- Controlled-write E2E tests require explicit approval before execution.
- Test-created data must use the `e2e_` prefix.
- Cleanup must delete only the exact captured ID created by the test.
- Never bulk delete, delete by title, or clean up old data without separate approval.
- Never expose auth artifacts, credentials, cookies, localStorage, authorization headers, or tokens.

## UI/UX Rules

- Follow mobile-first principles.
- Support Arabic and English.
- Support RTL and LTR.
- Consider accessibility.
- Consider touch usability.
- Consider responsive behavior.
- Review consistency across related screens and states.
- Review loading states.
- Review empty states.
- Review error states.
- Review success states.
- Review disabled states.
- Review long-content behavior.
- Review image handling.
- Review keyboard behavior where relevant.
- Do not infer visual quality from CSS alone.
- Do not claim browser-visible issues without browser evidence.
- Distinguish code-level UX findings from visually verified findings.
- Distinguish UX recommendations from confirmed defects.

## Required Output For Implementation Work

Always report:

- objective
- operating mode
- current-state evidence
- relevant file paths
- proposed approach
- files changed
- business-logic impact
- frontend impact
- backend impact
- API-contract impact
- security/privacy impact
- database impact
- realtime impact where relevant
- PWA impact where relevant
- tests run
- build/typecheck/lint results
- runtime verification
- browser verification
- remaining risks
- unverified assumptions

## Specialist Review Summary

Future implementation summaries must include:

- roles applied
- key concerns found
- risks
- tests required
- unresolved product decisions
