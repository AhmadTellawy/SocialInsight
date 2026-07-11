# socialinsight Verification Standard

Every future socialinsight task must state exactly which verification levels were completed, which were not completed, why any level was skipped, and what remains unverified.

A change must not be described as fully verified when only static inspection was completed.

## Level 1 - Static Code Inspection

Includes:

- source review
- configuration review
- schema review
- contract review

Use this level to identify code-level findings, architecture risks, likely contract mismatches, security review targets, and areas requiring runtime validation.

Limitations:

- Does not prove runtime behavior.
- Does not prove browser-visible UX.
- Does not prove database behavior with live data.
- Does not prove deployment behavior.

## Level 2 - Typecheck / Lint / Build

Includes:

- TypeScript checks
- lint
- compilation
- production build

Use this level to verify that code compiles and static tooling accepts the change.

Limitations:

- A successful build does not prove functional correctness.
- A successful build does not prove security, privacy, or database integrity.
- A successful build does not prove browser UX.

## Level 3 - Unit Tests

Includes:

- isolated logic
- utilities
- services
- components where appropriate

Use this level to verify deterministic behavior in small units.

Limitations:

- Unit tests do not prove route integration, database behavior, or full user journeys.

## Level 4 - Integration Tests

Includes:

- API routes
- database interaction
- authentication flows
- service integration

Use this level to verify server behavior across routes, services, persistence, and auth boundaries.

Limitations:

- Integration tests do not prove browser UI behavior unless they include a browser.
- Integration tests must clearly distinguish test database use from staging or production database use.

## Level 5 - Browser E2E Tests

Includes real user journeys such as:

- registration
- login
- post creation
- poll creation
- voting
- privacy flows

Use this level to verify user-facing flows through the rendered application and backend where applicable.

Limitations:

- E2E tests can miss visual quality issues unless screenshots or visual assertions are included.
- E2E tests must use controlled test data and safe environments.

### ONLINE_NO_WRITE Verification

ONLINE_NO_WRITE browser tests target the deployed online socialinsight app and must not intentionally create, update, or delete data.

Examples:

- app-load smoke
- login page render
- navigation smoke
- poll advanced settings UI
- mobile layout smoke
- language/RTL smoke
- read-only authenticated checks after storageState exists

### ONLINE_CONTROLLED_WRITE Verification

ONLINE_CONTROLLED_WRITE browser tests target the deployed online socialinsight app and require explicit approval before execution.

Required constraints:

- use dedicated test accounts only
- use `e2e_` prefixed test data
- capture the created artifact ID before cleanup
- delete only the exact captured ID
- do not bulk delete
- do not delete by title
- do not use direct database cleanup
- do not run Prisma commands or migrations
- do not run unapproved follow, privacy, notification, vote, comment, like, save, share, report, or push-subscription write tests

## Level 6 - Visual Screenshot Verification

Includes:

- rendered screens
- responsive states
- before/after evidence
- visual regressions

Use this level to confirm visible layout, clipping, overlap, spacing, responsiveness, and rendered state quality.

Limitations:

- Screenshots do not prove deeper functional correctness.
- Screenshots cover only the captured states and viewports.

## Level 7 - Exploratory UX Review

Includes:

- realistic user journey
- usability friction
- navigation
- interaction feedback
- unexpected states

Use this level to identify practical friction, confusing transitions, missing recovery paths, and product experience issues.

Limitations:

- Exploratory review includes judgment and should distinguish confirmed defects from recommendations.

## Required Verification Report

Every implementation or verification report must state:

- levels completed
- levels not completed
- reason each skipped level was skipped
- commands or tools used
- runtime environment, if any
- browser and viewport, if any
- database environment, if any
- test data used, if any
- target URL for E2E verification, if any
- E2E test class: ONLINE_NO_WRITE or ONLINE_CONTROLLED_WRITE, if any
- whether writes occurred
- whether cleanup succeeded when writes occurred
- screenshots, traces, or videos generated, by path only
- whether token-like content exposure was checked
- failures or flaky behavior
- remaining unverified assumptions
