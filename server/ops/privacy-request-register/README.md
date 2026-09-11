# Local privacy request register

This Windows-only operator ledger records the handling of privacy requests. It performs no account operation, disclosure, deletion, network request, provider action or message delivery. It is separate from the application DeletionDecision journal and runs outside the compiled server runtime. PowerShell 7.5 or later is required; the rehearsal uses 7.6.5.

The operational location is fixed to `%LOCALAPPDATA%\SocialInsightPrivacyRegister`. Independent E03/E04 review and E01 acceptance of the synthetic evidence must precede the first operational initialization. A01 owns that step. The exact command, from the candidate repository, is:

```powershell
pwsh -NoLogo -NoProfile -File server/ops/privacy-request-register/register.ps1 -Command init -Mode OPERATIONAL
```

Do not run initialization against an existing directory or restore an older file to make initialization succeed. Initialization refuses existing paths and does not repair permissions or overwrite a store. Empty initialization proves only local readiness; it creates no privacy request.

The directory, command directory and files have an explicit protected DACL granting FullControl only to the current Windows SID and SYSTEM; the current SID is the owner. Reparse components, foreign ACLs, Git locations and unexplained pending files fail closed. The entire JSON envelope and every command input use native CurrentUser DPAPI. No application password, API token or encryption credential is created. SYSTEM ACL access does not establish DPAPI key recovery.

`register.bin` is the only committed ledger file. `register.lock` is a persistent exclusive file lock. Updates decrypt under that lock, check the expected revision, validate the entire envelope, write and flush an encrypted temporary file, and replace the prior ciphertext atomically with no backup copy. A leftover `pending-*.bin` blocks access: preserve it and investigate the unknown write outcome. Do not silently delete it or select an older register. Filesystem power-loss durability, device-loss recovery and anti-rollback are not proven. This tool does not protect against malware running as the same Windows user or a local administrator.

## Operating a case

Use the existing restricted correspondence/case detail to record the actual requester, recipient channel, supporting evidence and human decisions. Only random UUIDv4 references, fixed enums, timestamps and counters belong in this ledger. Never use an email, name, IP, message text, provider object identifier, credential, URL, full path or identity document in a ledger field. IDs must be opaque local references, not transformed direct identifiers. The CLI never proves that a human verification, copy inventory or legal decision is true; it enforces that the operator records the required decision for the same subject and scope.

Prepare an action as an in-memory PowerShell hashtable matching `command.schema.json`, then encrypt it using the exported function. Do not create a plaintext JSON file, paste personal information into a shell, enable transcripts of case detail, or copy case detail into Git/task evidence. The following pattern deliberately has no real request values:

```powershell
Import-Module ./server/ops/privacy-request-register/Register.psm1
$status = Invoke-PrivacyRegister -Command status -Mode OPERATIONAL
# Build $action in memory from opaque references and the exact schema.
# Bind mode=OPERATIONAL, registerId=$status.registerId and expectedRevision=$status.revision.
$inputPath = New-PrivacyRegisterInput -Mode OPERATIONAL -InputObject $action
Invoke-PrivacyRegister -Command apply -Mode OPERATIONAL -InputFile $inputPath
```

Only encrypted inputs directly under the store's `commands` directory are accepted. Successful processing consumes the input. Rejected inputs remain encrypted for inspection/correction; there are at most 100 pending input files. Remove superseded command files only after checking the latest state and unknown outcome. Status prints aggregate counts, register ID and revision; it never prints decrypted case records, subject references or correspondence references. There is no plaintext export command.

Every action has an event UUID, correlation UUID, evidence UUID, reason enum and an operator-selected next-action date. The engine supplies event time, actor role and state. A normal exact event replay (including its original expected revision and all fields) returns `replayed=true` without another event. Reusing that ID with a different payload fails. A stale new action fails with `REVISION_CONFLICT`; `STORE_BUSY` means another process holds the lock. After an unknown write outcome, reload status under lock and retry the identical protected action; never invent success or create a new event just to bypass a conflict.

The minimum handling sequence is `create`, transition to `VERIFYING`, `verify`, transition to `ASSESSING`, record all relevant `dependency` entries, `assess`, `execute-start`, record every scope `result`, transition to `CHECKING`, record `delivery`, then transition to the appropriate closure. The schema is the exact field contract. Explicit evidence is required for non-applicability; omission is not non-applicability. Assessment includes a human review of the complete provider/storage/backup inventory and other people's data. At least one entry for each of PROVIDER, STORAGE and BACKUP is required even when justified as not applicable; record every relevant provider, not just the minimum number of entries.

Personal ACCESS, EXPORT, CORRECT and ERASE execution requires VERIFIED subject/scope, current assessment and a new scoped authorization reference. `NOT_REQUIRED` is limited to OTHER with the sole INFORMATION scope. The record documents a manual human check; it neither authorizes an application account nor impersonates the requester. `reset-scope` is the only subject/scope mutation: it requires a new scope reference and explicit disposition for each removed category, returns to VERIFYING, clears authority and resets results/dependencies for rechecking. Use a fresh event/evidence reference. Closed cases reopen explicitly before changes. Withdrawal preserves performed processing facts and never reverses an application deletion.

CLOSED_COMPLETE requires a supported result for every scoped category and no open non-delivery dependency. CLOSED_LIMITED requires `LIMITED_SCOPE_RESULT`; unresolved results link to open dependencies with an owner and next date. FAILED/UNKNOWN delivery can close processing only with a dated administrative reason and matching active DELIVERY followup. It remains FAILED/UNKNOWN. SENT and PROVIDER_ACCEPTED are UNKNOWN, never DELIVERED. DELIVERED requires the case correspondence reference and an explicit recipient acknowledgement, verified provider delivery or authenticated download evidence. These are operator attestations tied to protected evidence, not new provider verification performed by this CLI. Closed-case invariants are rechecked on every read, mutation and retirement. A FAILED/UNVERIFIED outcome must retain its exact active, owned, dated dependency; resolving it requires explicit reopening and outcome rechecking. An UNKNOWN/FAILED administrative delivery closure must retain the exact linked active DELIVERY dependency and matching date. Replacement, date/type changes or premature resolution are rejected. Record actual DELIVERED evidence first, then resolve that followup; historical events and unrelated obligations remain. New obligations require reopening.

Dates are UTC instants of the form `2026-09-10T12:00:00.000Z`. `nextActionAt` and retention `reviewAt` are internal dates, not legal promises. `legalDueAt` stays null unless an actually verified applicable deadline has a corresponding `legalSourceRef`; the tool cannot decide jurisdiction. It never resets a legal deadline on waiting/escalation.

## Protected in-memory inspection

The exported `Get-PrivacyRegisterInspection` API supports CASES (discover opaque case IDs), DUE (operator, dependency, delivery, retention and legal followups due at capture time), CASE (current scope/results/dependencies/delivery), EVENTS (case history) and EVENT (one event outcome). It is read-only under the same exclusive lock, exact ACL, CurrentUser DPAPI, schema and closed-obligation guards as writes. It does not create a missing store or request, consume inputs, advance revisions, repair inconsistent state or create export files.

A mandatory `[ref]` result keeps case data out of the normal pipeline. Run it only in a trusted local PowerShell process without transcripts; assign its result in memory and do not print it, serialize it to disk, pipe it to logging, or create retained copies. This API cannot prevent an authorized same-user process from deliberately printing or copying memory. The regular CLI still prints aggregate metadata only and has no full-case inspection/export command.

```powershell
$status = Invoke-PrivacyRegister -Command status -Mode OPERATIONAL
$queue = $null
Get-PrivacyRegisterInspection -Mode OPERATIONAL -RegisterId $status.registerId -Query DUE -Result ([ref]$queue)
$cases = $null
Get-PrivacyRegisterInspection -Mode OPERATIONAL -RegisterId $status.registerId -Query CASES -Limit 50 -Result ([ref]$cases)
# Keep the chosen opaque request ID in memory; no transcript or plaintext file.
$case = $null
Get-PrivacyRegisterInspection -Mode OPERATIONAL -RegisterId $status.registerId -Query CASE -RequestId $chosenRequestId -Result ([ref]$case)
```

Collection queries default to 50 entries and cap at 100. `nextOffset` identifies another page; nonzero offsets require `-ExpectedRevision` from the first page. Revision changes reject continuation so the operator reloads, rather than combining inconsistent pages. Overdue followups remain readable and appear in DUE; the read guard does not treat passage of time as corruption or authorization.

EVENT requires the case and event IDs. Its optional `-ExpectedInputFile` accepts the original protected action input in this store's commands directory and compares its entire operation digest, including original expectedRevision. `RECORDED_EXACT` supports retry reconciliation; `RECORDED_CONFLICT` requires investigation. Without that input, `RECORDED` proves event presence only. `NOT_FOUND` does not distinguish a never-recorded identifier from one removed by retirement and never proves retirement by itself. Missing IDs never recreate anything. Retirements intentionally have no retained request-linked event/digest; inspect the reviewed copy inventory as well as current absence. Clear inspection variables when done; no new persisted inspection-copy lifecycle is introduced.

## Retirement and recovery limit

Retirement requires a closed/withdrawn case, no open dependencies or delivery followups, a human retention decision, and a reviewed complete copy inventory. Inventory must cover temporary/detail material, correspondence, backups and recovery copies, with each copy explicitly verified removed or verified to contain no request references. These opaque attestations must refer to real external checks; the tool cannot inspect a provider or prove external erasure. UNKNOWN/FAILED delivery cannot retire. A withdrawn case with no attempted delivery may retire only after its obligations and inventory are resolved.

Retirement removes the request and every historical event belonging to it, and removes encrypted pending command copies for the request before committing. It retains only a nonidentifying retirement count. No request-linked digest is retained. Accordingly, retirement is an explicit exception to normal replay: the exact original retirement command, retaining its old expectedRevision, returns REVISION_CONFLICT. A lookup attempt with the current revision returns REQUEST_NOT_FOUND. Both are fail-closed outcomes requiring protected inspection and copy-inventory review; neither is an idempotent success acknowledgement. It never recreates the case. An unchanged stale old create command also fails its revision check. This exception is proposed for independent E05 disposition.

No backup/recovery-copy scheme is enabled. Any existing owned copy with request references blocks retirement until actually removed. Never resume an older recovered register: reconciliation of retirements before use is required but is not implemented by this single-device tool. There is no SSD forensic-erasure guarantee, no hidden retention period, and no deletion-journal purge. Closing a case or waiting seven days cannot retire DeletionDecision or application aliases.

## Synthetic verification

```powershell
pwsh -NoLogo -NoProfile -File server/ops/privacy-request-register/register.test.ps1 -EvidenceDirectory <existing-task-baseline-directory>
```

The suite creates only distinct `%TEMP%\SocialInsightPrivacyRegister-Synthetic-<UUID>` directories, uses actual CurrentUser DPAPI/ACLs and two actual CLI processes, records only sanitized synthetic evidence and validates resolved paths before cleanup. It refuses operational-path mixing. Before/after hashes bind the module, schemas, CLI, tests and this README. The tool has no npm dependencies, and does not modify the application schema, database or source. Tests cannot establish that a real request, provider action, legal decision, external copy removal, hosted deployment or delivery occurred.

