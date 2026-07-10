# socialinsight Code Review Standard

Use this standard for all code reviews in socialinsight. Reviews must distinguish confirmed source evidence from inference and must cite relevant file paths for material findings.

## 1. Correctness

- Confirm the implementation matches the intended behavior.
- Check edge cases, invalid states, empty inputs, duplicate submissions, and partial data.
- Verify state transitions are valid and reversible where needed.
- Review failure scenarios and confirm they do not leave inconsistent UI, server state, or database state.
- Do not assume runtime correctness from static inspection alone.

## 2. Maintainability

- Review file size and complexity.
- Check whether responsibilities are clear and locally understandable.
- Prefer cohesive modules with clear boundaries.
- Flag files that combine routing, UI, API calls, business logic, persistence, and side effects.
- Review readability, naming, coupling, and cohesion.
- Identify changes that make future fixes riskier.

## 3. Duplication

- Look for duplicate frontend logic.
- Look for duplicate backend logic.
- Look for duplicate API clients.
- Look for duplicate validation.
- Look for duplicate privacy rules.
- Look for duplicate business rules.
- Prefer shared, well-named helpers only when they reduce real complexity.

## 4. Separation Of Concerns

- Keep UI concerns separate from business logic where practical.
- Keep controllers focused on transport, validation, orchestration, and response handling.
- Move reusable domain rules into services when they are shared or security-sensitive.
- Separate API handling from data access.
- Separate authentication from authorization.
- Separate domain logic from transport logic.

## 5. Error Handling

- Check expected failures and unexpected failures.
- Confirm user-visible errors are useful and safe.
- Confirm server logs do not expose secrets or sensitive personal data.
- Review retry behavior and duplicate action risks.
- Check partial-success handling, especially where database writes, notifications, realtime events, or external services are involved.
- Ensure failures are not silently swallowed unless there is an explicit reason.

## 6. Type Safety

- Review unsafe casts and `any` usage.
- Check frontend/backend API contract consistency.
- Review nullable values and optional fields.
- Check mismatched identifiers, enum-like strings, and date formats.
- Verify request and response types align with server behavior.
- Flag any type workaround that hides a real contract mismatch.

## 7. Async Behavior

- Check missing `await` usage.
- Review stale state risks in React components and hooks.
- Review duplicate submissions and button disabling.
- Review out-of-order responses.
- Review optimistic updates and rollback behavior.
- Confirm async errors are handled in both frontend and backend code.

## 8. Concurrency

- Identify lookup-then-create risks.
- Identify manual counter-update risks.
- Identify duplicate operation risks.
- Check transactional integrity.
- Confirm database constraints enforce critical uniqueness.
- Require transaction use when multiple writes must succeed or fail together.

## 9. Performance

- Look for N+1 database queries.
- Look for unnecessary rerenders.
- Look for oversized request or response payloads.
- Look for repeated requests that should be cached or batched.
- Review expensive transformations, image processing, and large JSON payloads.
- Review database indexes for common filters, joins, and sorts.

## 10. Regression Risk

- Identify shared components, shared services, shared routes, and shared database models affected by the change.
- Check cross-module effects.
- Review behavior changes and hidden dependencies.
- Require broader verification when a change touches authentication, privacy, database schema, notifications, realtime behavior, or shared UI.

## 11. Testability

- Prefer isolated logic that can be tested without full app setup.
- Favor deterministic behavior.
- Keep dependency boundaries clear.
- Identify missing test seams.
- Identify critical untested paths.
- Do not describe a change as fully verified unless the appropriate verification levels were completed.

