# socialinsight Natural Language Intent Router

## 1. Purpose

The user should not need to mention internal protocol names such as "deep audit protocol", "controlled-write workflow", or "multi-role review". The socialinsight Product & Engineering Agent must infer the right workflow from normal Arabic or English wording and then state the selected workflow, scope, roles, testing permissions, and approval needs.

The agent must support natural wording such as:

- "افحص آلية عمل إعدادات الخصوصية باحترافية"
- "راجع آلية عمل المجموعات"
- "شوف تسجيل الحسابات إذا شغال صح"
- "قيّم صفحة إنشاء Poll"
- "افحص الفولو والفولو ريكويست"
- "اختبر التصويت أونلاين"
- "نفذ التعديلات 1 و 2 و 5"
- "Audit login"
- "Review group permissions"
- "Run the online voting test"

## 2. Intent Categories

### A. Deep Process / Feature Audit

Triggered by wording such as:

- "افحص آلية عمل..."
- "راجع آلية عمل..."
- "حلل..."
- "قيّم بشكل شامل..."
- "شوف إذا ... شغال صح"
- "اعطيني ملاحظات احترافية على..."
- "audit"
- "review"
- "inspect"
- "evaluate"
- "analyze"

Default behavior:

- Use `docs/agent/process-audit-protocol.md`.
- Do not implement changes.
- Produce numbered findings.
- Produce priorities.
- Produce an implementation roadmap.
- Wait for user approval of finding IDs.

Examples:

- "افحص آلية عمل إعدادات الخصوصية"
- "راجع آلية عمل تسجيل الحسابات"
- "شوف آلية عمل المجموعات"
- "حلل نظام الفولو والفولو ريكويست"
- "Audit poll creation"
- "Review registration end to end"

### B. UI/UX Review

Triggered by wording such as:

- "قيّم التصميم"
- "رأيك بالواجهة"
- "حسّن تجربة المستخدم"
- "الشاشة"
- "التصميم"
- "UI/UX"
- "layout"
- "mobile"
- "screen"
- "interface"

Default behavior:

- Review UI/UX, accessibility, i18n, and mobile-first behavior.
- Apply UI/UX Designer and Accessibility & Internationalization Specialist roles.
- If the UI is rendered or needs browser validation, state that visual evidence requires browser/screenshot verification.
- Do not modify unless explicitly asked.

### C. Security / Privacy Review

Triggered by wording such as:

- "الخصوصية"
- "صلاحيات"
- "private account"
- "visibility"
- "search privacy"
- "auth"
- "login"
- "OTP"
- "JWT"
- "groups access"
- "permissions"
- "authorization"
- "token"

Default behavior:

- Security & Privacy Engineer review is mandatory.
- Product Logic Analyst review is mandatory when product behavior or visibility is involved.
- Server-side authorization review is mandatory.
- Do not rely on frontend-only checks.
- Produce risks and priorities.

### D. Practical E2E Verification

Triggered by wording such as:

- "جرّب عمليًا"
- "اختبر أونلاين"
- "شوف إذا العملية بتشتغل"
- "run E2E"
- "test online"
- "browser test"
- "smoke test"
- "verify online"

Default behavior:

- Use online-only E2E guardrails.
- For no-write tests, run safe no-write verification when permitted.
- For write tests, require controlled-write approval and exact-ID cleanup.
- Never write data unless explicitly approved.
- Never print credentials, tokens, cookies, localStorage, sessionStorage, storageState contents, Authorization headers, or sensitive request/response bodies.

### E. Implementation of Approved Findings

Triggered by wording such as:

- "نفذ REG-01 و REG-03"
- "طبق التعديلات 1 و 2 و 5"
- "أصلح المشكلة رقم..."
- "implement selected findings"
- "fix POLL-01"
- "apply items 1, 2, and 5"

Default behavior:

- Implement only the approved finding IDs or clearly specified items.
- Do not implement unapproved findings.
- If dependencies exist, stop and explain.
- Run relevant tests only.
- Commit only if instructed or if the approved workflow says to commit.
- Report exact files changed and verification results.

### F. Cleanup

Triggered by wording such as:

- "نظف بقايا e2e"
- "احذف العنصر التجريبي"
- "cleanup residue"
- "delete test artifact"
- "remove e2e data"

Default behavior:

- Exact-ID cleanup only.
- No bulk delete.
- No delete by title only.
- No old or unknown cleanup unless explicitly approved and exact ID is confirmed.
- No direct database cleanup unless separately approved.
- Report safe path/ID/status details only.

### G. Deployment / Release

Triggered by wording such as:

- "انشر"
- "deploy"
- "push to main"
- "production"
- "Vercel"
- "Render"
- "sync deployment"
- "release"

Default behavior:

- Run deployment preflight.
- Do not deploy or push without explicit approval.
- Confirm changed files and build impact.
- Confirm branch and target.
- Never run database commands unless separately approved.
- Never force push.

## 3. Natural Language Examples

| User says | Agent interprets |
| --- | --- |
| "افحص آلية عمل إعدادات الخصوصية باحترافية" | Deep Process Audit + Security/Privacy Review + Product Logic + UI/UX + E2E verification plan. No implementation. |
| "راجع آلية عمل المجموعات" | Deep Process Audit for groups, including group creation, membership, posting, visibility, roles, permissions, database, backend, frontend, UI/UX, and tests. |
| "شوف تسجيل الحسابات إذا شغال صح" | Deep Process Audit for registration, with auth/security review, frontend/backend/API/database review, OTP if applicable, and practical verification plan. |
| "قيّم صفحة إنشاء Poll" | UI/UX Review plus Product Logic review for Poll creation; include accessibility/i18n/mobile concerns and state whether browser evidence is needed. |
| "افحص الفولو والفولو ريكويست" | Deep Process Audit for follow/follow-request flows with mandatory Security/Privacy and Product Logic review. |
| "اختبر التصويت أونلاين" | Practical E2E Verification. If voting writes online, require controlled-write approval, dedicated test accounts, and exact-ID cleanup. |
| "نفذ التعديلات 1 و 2 و 5" | Implementation mode for approved findings/items only; do not implement other findings. |
| "Review search privacy" | Security / Privacy Review plus Deep Process Audit if the user expects end-to-end behavior. |
| "Deploy the poll fix" | Deployment / Release workflow with preflight and explicit push/deploy approval. |
| "Cleanup the old e2e poll" | Cleanup workflow; require exact ID and explicit approval before deleting old/unknown data. |

## 4. Default Behavior Rules

- If the user asks to inspect, review, audit, evaluate, or analyze, default to audit mode, not implementation.
- If the user asks to implement, fix, apply, or execute, default to implementation mode, but only for clearly specified items.
- If the user asks to test online and writes are involved, require controlled-write rules.
- If the user wording is broad but understandable, proceed with a reasonable inferred scope and state the scope.
- Ask a clarifying question only when the scope is impossible to infer or when there is a safety risk.
- Do not ask the user to repeat the request in a special format.
- Do not require the user to mention protocol names.
- Always report which workflow was selected and why.
- If a request combines audit and implementation, audit comes first unless the user explicitly approves implementation.

## 5. Required Opening Section for Future Responses

When starting a task, the agent should include a short workflow summary:

```text
Selected Workflow:
Relevant Specialist Roles:
Scope Interpreted:
Implementation Allowed? Yes/No:
Testing Allowed? No-write / Controlled-write / Not allowed:
Approval Needed Before Writes? Yes/No:
```

For very small direct tasks, this may be concise, but the selected workflow must still be clear.

## 6. Required Behavior for Broad Feature Audits

For broad requests like:

- "افحص الخصوصية"
- "افحص المجموعات"
- "افحص تسجيل الحسابات"
- "review auth"
- "audit search"
- "inspect notifications"

The agent must cover:

- current flow
- target flow
- frontend
- backend
- database
- product logic
- security/privacy
- UI/UX
- accessibility/i18n
- analytics
- performance
- trust & safety
- practical verification
- findings register
- priorities
- implementation batches

Use `docs/agent/process-audit-protocol.md` as the required structure.

## 7. Ambiguity And Safety Rules

- If the feature is clear but the boundaries are broad, define a reasonable scope and state exclusions.
- If the request could involve online writes, do not write until explicit approval is present.
- If credentials, auth state, tokens, cookies, or localStorage would be needed, do not print them.
- If implementation items are described by numbers, map them to prior finding IDs or ask only if the mapping is unclear.
- If a requested implementation depends on another unapproved finding, stop and explain the dependency.
- If cleanup is requested without an exact ID, perform discovery only unless separate explicit approval and safe identifiers are available.

## 8. Workflow Selection Cheat Sheet

| Natural signal | Workflow |
| --- | --- |
| audit, inspect, review, analyze, evaluate, "افحص", "راجع", "حلل", "قيّم" | Deep Process / Feature Audit |
| design, UI, UX, interface, screen, mobile, "واجهة", "تصميم", "الشاشة" | UI/UX Review |
| privacy, auth, OTP, permissions, visibility, private, "خصوصية", "صلاحيات" | Security / Privacy Review |
| test online, E2E, browser test, "اختبر أونلاين", "جرّب عمليًا" | Practical E2E Verification |
| implement, fix, apply, "نفذ", "طبق", "أصلح" | Implementation of approved findings or clearly specified work |
| cleanup, residue, "نظف", "احذف العنصر التجريبي" | Cleanup workflow |
| deploy, push, production, Vercel, Render, "انشر" | Deployment / Release workflow |

## 9. Required Reporting

Every task response should report:

- selected workflow
- relevant specialist roles
- interpreted scope
- implementation permission
- testing permission
- write approval status
- any unresolved ambiguity or safety gate

For implementation summaries, also include the Specialist Review Summary required by `AGENTS.md`.
