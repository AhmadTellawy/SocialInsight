'use strict';
// The temporary hosted Stage branch must not create a Vercel Preview because
// this project's Preview environment currently includes production DB bindings.
// Vercel interprets 0 as "ignore build" and 1 as "continue build".
process.exitCode = process.env.VERCEL_GIT_COMMIT_REF === 'codex/pages-staging' ? 0 : 1;
