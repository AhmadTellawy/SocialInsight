# socialinsight Group And Page Fixture Plan

## Purpose

Prepare future online E2E coverage for group and page behavior without creating group/page data in the current task.

This plan is documentation only. It does not create groups, pages, memberships, invites, posts, or cleanup actions.

## Required Personas

The following local auth states are required:

- `tests/e2e/.auth/group_owner.json`
- `tests/e2e/.auth/group_member.json`
- `tests/e2e/.auth/page_owner.json`

Current provisioning has produced these storageState files, but their contents must remain ignored and unprinted.

## Intended Future Fixtures

Future fixture setup may create:

- one public `e2e_` group owned by `group_owner`
- one membership relationship for `group_member`
- one `e2e_` business/page entity owned by `page_owner`

No fixture should use real user accounts or non-`e2e_` names.

## Required Approval Gate

Group/page fixture setup must not run unless this variable is set:

```text
ONLINE_GROUP_PAGE_FIXTURE_APPROVED=true
```

The setup must also require:

```text
E2E_BASE_URL=https://socialinsightapp.com/
ONLINE_E2E_APPROVED_API_HOSTS=socialinsight-api.onrender.com
```

## Evidence From Current Code

- Group/page creation UI is implemented in `components/CreateAccountModal.tsx`.
- Group creation API client is implemented in `services/api.ts`.
- Group routes are implemented in `server/src/routes/groupRoutes.ts`.
- Group controller logic is implemented in `server/src/controllers/groupController.ts`.
- User group lookups are available through `services/api.ts` and `server/src/routes/userRoutes.ts`.

## Allowed Future Writes

Only after explicit approval:

- `POST socialinsight-api.onrender.com /api/groups` for one captured `e2e_` group/page fixture.
- One membership/join/invite/approval mutation only if the exact route and actor are confirmed.
- Cleanup only by exact captured group/page ID, if a safe app-supported delete endpoint is confirmed.

## Blocked Mutations

Always block unless separately approved:

- posts and polls not belonging to the fixture test
- votes, comments, likes, saves, shares, reports
- notification writes
- bulk deletes
- delete-by-title
- cleanup of old or unknown `e2e_` data
- account deletion
- direct database access
- Prisma commands

## Cleanup Strategy

Preferred:

1. Capture the exact group/page ID from the create response.
2. Verify the fixture exists using a read request.
3. Cleanup only that exact captured ID in `finally`.
4. Fail and report safe ID/path/status details if cleanup fails.

Do not:

- delete by name,
- delete by prefix,
- delete old fixtures,
- bulk delete groups/pages,
- delete users.

## Risk Notes

- The same `api.createGroup` function appears to support both groups and company/page-style entities through submitted form data.
- The exact backend distinction between a group and a business page should be verified before implementation.
- Membership setup can create durable relationships, so it must be idempotent and route-specific.
- Group/page deletion may be destructive; confirm whether the app-supported delete endpoint is safe and scoped to the captured fixture before using it.

## Recommended Future Implementation Sequence

1. Create `tests/e2e/group-page-fixtures.setup.ts`.
2. Add online-only and approval gates.
3. Require the three persona storageState files.
4. Implement read-first fixture discovery for current-run artifacts only.
5. Create one group fixture and capture ID.
6. If safe, add one membership flow for `group_member`.
7. Create one page fixture and capture ID only after page semantics are confirmed.
8. Cleanup only current-run captured IDs unless a later task explicitly approves persistent fixtures.
9. Clean generated Playwright artifacts.
10. Commit only after the setup passes and no unexpected mutations occur.

## Current Blockers

- No explicit `ONLINE_GROUP_PAGE_FIXTURE_APPROVED=true` gate was set for this task.
- The backend distinction between group and page fixtures requires additional confirmation.
- Cleanup semantics for group/page fixtures need a separate review before any online creation.
