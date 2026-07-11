# socialinsight Account Relationship Provisioning Plan

## Purpose

Prepare future online E2E privacy tests using dedicated personas only:

- `private_user`
- `follower_user`
- `non_follower_user`

This plan is documentation only. It does not provision relationships or change online account state.

## Current Evidence

- Auth states exist locally for all three personas:
  - `tests/e2e/.auth/private_user.json`
  - `tests/e2e/.auth/follower_user.json`
  - `tests/e2e/.auth/non_follower_user.json`
- The frontend exposes account privacy controls in `components/ProfileSettingsScreen.tsx`.
- The API client exposes profile privacy updates and follow flows in `services/api.ts`.
- Follow routes are defined in `server/src/routes/userRoutes.ts`.
- Follow request behavior is implemented in `server/src/controllers/followController.ts`.
- User privacy update behavior is implemented in `server/src/controllers/userController.ts`.

## Required Approval Gate

Relationship provisioning must not run unless this variable is set:

```text
ONLINE_ACCOUNT_RELATIONSHIP_PROVISIONING_APPROVED=true
```

The setup must also require:

```text
E2E_BASE_URL=https://socialinsightapp.com/
ONLINE_E2E_APPROVED_API_HOSTS=socialinsight-api.onrender.com
```

## Intended State

- `private_user` has `isPrivate=true`.
- `follower_user` has an approved active follow relationship to `private_user`.
- `non_follower_user` has no follow relationship to `private_user`.

## Proposed Safe Flow

1. Load `private_user` auth state.
2. Verify current privacy status through a read request.
3. If needed and explicitly approved, update only `private_user.isPrivate=true`.
4. Load `follower_user` auth state.
5. Send one follow request to `private_user` only if no existing relationship exists.
6. Load `private_user` auth state.
7. Approve only the captured/requested `follower_user` relationship.
8. Load `non_follower_user` auth state.
9. Verify `non_follower_user` remains `NONE` or not followed.

## Mutation Allowlist

Allowed only after explicit approval:

- `PUT socialinsight-api.onrender.com /api/users/{private_user_id}`
- `POST socialinsight-api.onrender.com /api/users/{private_user_id}/follow`
- `POST socialinsight-api.onrender.com /api/users/{follower_user_id}/accept-follow`

Blocked:

- posts, polls, votes, comments, likes, saves, shares, reports
- group and page mutations
- notifications read/write mutations
- account deletion
- bulk cleanup
- direct database actions

## Idempotency Requirements

- Check existing privacy and follow state before writing.
- Do not toggle follow state blindly because the follow endpoint can also unfollow or cancel.
- Do not remove followers or reject requests during setup.
- Do not print persona credentials, tokens, cookies, storageState, localStorage, sessionStorage, request bodies, or authorization headers.

## Recommended Future Implementation

Create:

```text
tests/e2e/account-relationships.setup.ts
```

Run only:

```text
npx.cmd playwright test tests/e2e/account-relationships.setup.ts --project=setup
```

Commit only after:

- setup is idempotent,
- all intended states are verified,
- no unexpected mutations are observed,
- no secrets are exposed,
- generated Playwright artifacts are cleaned.

## Current Blockers

- Relationship writes were not performed because `ONLINE_ACCOUNT_RELATIONSHIP_PROVISIONING_APPROVED=true` was not set for this task.
- UI selector reliability for follow-request approval still needs browser verification before relying on UI-only setup.
