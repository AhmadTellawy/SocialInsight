# Scope and authority worklog

- Task: `SI-SECURITY-REMEDIATION-15-26-20260912`
- Recorded at: `2026-09-12T20:34:45.2800810Z`
- Founder authority: implement the complete remediation for audit points 15–26 and deploy it to the existing online production target without repeated approval requests for routine execution.
- Production target: `TARGET-PRODUCTION-OPINIUP` — Vercel frontend `social-insight` at `https://opiniup.com` and Render backend `srv-d70vn4p4tr6s73e2qnjg` at `https://socialinsight-api.onrender.com`.
- Allowed execution: repository changes, additive compatible migrations, tests, independent gates, existing staging path, traceable commit/push, provider deployment, non-destructive live smoke checks, monitoring, and rollback through the established path.
- Excluded without a new explicit decision: destructive changes to existing user data, destructive reset/restore, purchases or new accounts, publication of legal text, messages to real users, secret disclosure, and destructive production testing.
- Source protection: implementation is isolated in `C:/Users/ABC/Downloads/socialinsight/.worktrees/security-remediation-release` on `codex/security-remediation-release`; pre-existing user changes in the primary checkout remain untouched.
