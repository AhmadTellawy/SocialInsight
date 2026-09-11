Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Role = 'FOUNDER_PRIVACY_HANDLER'
$script:ActiveStates = @('RECEIVED','VERIFYING','ASSESSING','EXECUTING','CHECKING','ESCALATED')
function Deny([string]$Code) { throw [InvalidOperationException]::new($Code) }
function Require([bool]$Condition, [string]$Code) { if (-not $Condition) { Deny $Code } }
function Json([object]$Value) { ConvertTo-Json -InputObject $Value -Depth 60 -Compress }
function Canonical([object]$Value) {
    if ($Value -is [System.Collections.IDictionary]) {
        $result = [System.Collections.Generic.SortedDictionary[string,object]]::new([StringComparer]::Ordinal)
        foreach ($key in $Value.Keys) { $result.Add($key, (Canonical $Value[$key])) }; return ,$result
    }
    if ($null -ne $Value -and $Value -isnot [string] -and $Value -is [System.Collections.IEnumerable]) {
        $items = @(); foreach ($item in $Value) { $items += ,(Canonical $item) }; return ,$items
    }
    return $Value
}
function Digest([object]$Value) {
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes((Json (Canonical $Value))))).ToLowerInvariant()
}
function Assert-UniqueKeys([System.Text.Json.JsonElement]$Element) {
    if ($Element.ValueKind -eq [System.Text.Json.JsonValueKind]::Object) {
        $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($property in $Element.EnumerateObject()) {
            Require ($seen.Add($property.Name)) 'DUPLICATE_KEY'
            Assert-UniqueKeys $property.Value
        }
    } elseif ($Element.ValueKind -eq [System.Text.Json.JsonValueKind]::Array) {
        foreach ($item in $Element.EnumerateArray()) { Assert-UniqueKeys $item }
    }
}
function Read-StrictJson([byte[]]$Bytes, [string]$SchemaName) {
    Require ($Bytes.Length -gt 0 -and $Bytes.Length -le 8388608) 'SIZE_LIMIT'
    $utf8 = [Text.UTF8Encoding]::new($false, $true)
    $text = $utf8.GetString($Bytes)
    $doc = [System.Text.Json.JsonDocument]::Parse($text)
    try { Assert-UniqueKeys $doc.RootElement } finally { $doc.Dispose() }
    if (-not (Test-Json -Json $text -SchemaFile (Join-Path $PSScriptRoot $SchemaName) -ErrorAction SilentlyContinue)) { Deny 'SCHEMA_INVALID' }
    return ConvertFrom-Json -InputObject $text -AsHashtable -Depth 60 -DateKind String
}
function Instant([string]$Value) {
    [DateTimeOffset]::ParseExact($Value, 'yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal)
}
function Validate-Dates([object]$Value) {
    if ($Value -is [System.Collections.IDictionary]) {
        foreach ($key in $Value.Keys) {
            if ($key -match 'At$' -and $null -ne $Value[$key]) { [void](Instant $Value[$key]) }
            Validate-Dates $Value[$key]
        }
    } elseif ($null -ne $Value -and $Value -isnot [string] -and $Value -is [System.Collections.IEnumerable]) { foreach ($item in $Value) { Validate-Dates $item } }
}
function Fresh-Date([string]$Value, [string]$Now) { Require ((Instant $Value) -gt (Instant $Now)) 'FOLLOWUP_DATE_REQUIRED' }
function Is-Information([object]$Request) { return $Request.kinds.Count -eq 1 -and $Request.kinds[0] -eq 'OTHER' -and $Request.scopeCodes.Count -eq 1 -and $Request.scopeCodes[0] -eq 'INFORMATION' }
function Verification-Ready([object]$Request) {
    $v = $Request.verification
    if (Is-Information $Request) { return $v.status -eq 'NOT_REQUIRED' -or ($v.status -eq 'VERIFIED' -and $v.subjectRef -eq $Request.subjectRef -and $v.scopeRef -eq $Request.scopeRef) }
    return $v.status -eq 'VERIFIED' -and $null -ne $Request.subjectRef -and $v.subjectRef -eq $Request.subjectRef -and $v.scopeRef -eq $Request.scopeRef -and $v.scopeDigest -eq (Digest $Request.scopeCodes)
}
function Reset-Verification([object]$Request) {
    $Request.verification = @{status='UNVERIFIED'; methodCode='NONE'; verifiedAt=$null; subjectRef=$null; scopeRef=$null; scopeDigest=$null; evidenceRef=$null}
    $Request.authorizationRef = $null; $Request.assessmentRef = $null
}
function Reset-Delivery([object]$Request) {
    $Request.delivery=@{status='NOT_ATTEMPTED';channelCode=$null;recipientRef=$null;proofCode=$null;evidenceRef=$null;followupAt=$null;administrativeClosureReason=$null}
}
function Reset-Results([object]$Request) {
    $Request.processingResults = @($Request.scopeCodes | ForEach-Object { @{scopeCode=$_; status='PENDING'; evidenceRef=$null; reasonCode='PENDING'; dependencyId=$null} })
}
function Dependency-Ready([object]$Request) {
    foreach ($type in @('PROVIDER','STORAGE','BACKUP')) { Require (@($Request.dependencies | Where-Object type -eq $type).Count -ge 1) 'DEPENDENCY_INVENTORY_INCOMPLETE' }
}
function Scope-Matches([object]$Request,[object]$Action) {
    Require ($Request.subjectRef -eq $Action.subjectRef -and $Request.scopeRef -eq $Action.scopeRef) 'SUBJECT_SCOPE_MISMATCH'
}
function Get-Request([object]$Store,[string]$Id) {
    $found = @($Store.requests | Where-Object id -eq $Id)
    Require ($found.Count -eq 1) 'REQUEST_NOT_FOUND'; return $found[0]
}
function Assert-ClosedObligations([object]$Request) {
    if ($Request.state -notin @('CLOSED_COMPLETE','CLOSED_LIMITED','WITHDRAWN')) { return }
    # Dates may become overdue without corrupting the record; inspection must still expose them.
    foreach ($outcome in $Request.processingResults) {
        if ($outcome.status -in @('FAILED','UNVERIFIED')) {
            Require (@($Request.dependencies | Where-Object { $_.id -eq $outcome.dependencyId -and $_.status -in @('OPEN','WAITING') -and $null -ne $_.nextActionAt -and $_.ownerRole -eq $script:Role }).Count -eq 1) 'ACTIVE_DEPENDENCY_REQUIRED'
        }
    }
    if ($Request.state -eq 'WITHDRAWN') { return }
    Require (Verification-Ready $Request) 'VERIFICATION_REQUIRED'
    Require ($null -ne $Request.assessmentRef -and ((Is-Information $Request) -or $null -ne $Request.authorizationRef)) 'ASSESSMENT_AUTHORIZATION_REQUIRED'
    Dependency-Ready $Request
    Require (@($Request.processingResults | Where-Object status -eq 'PENDING').Count -eq 0) 'PENDING_SCOPE'
    foreach ($outcome in $Request.processingResults) {
        Require ($null -ne $outcome.evidenceRef) 'RESULT_EVIDENCE_REQUIRED'
        if ($outcome.status -eq 'NOT_APPLICABLE') { Require ($outcome.reasonCode -eq 'JUSTIFIED_NOT_APPLICABLE') 'APPLICABILITY_REQUIRED' }
    }
    if ($Request.state -eq 'CLOSED_COMPLETE') {
        Require (@($Request.processingResults | Where-Object { $_.status -notin @('VERIFIED','NOT_APPLICABLE') }).Count -eq 0) 'UNVERIFIED_SCOPE'
        Require (@($Request.dependencies | Where-Object { $_.type -ne 'DELIVERY' -and $_.status -in @('OPEN','WAITING') }).Count -eq 0) 'OPEN_DEPENDENCIES'
    }
    $delivery=$Request.delivery
    Require ($delivery.status -in @('DELIVERED','UNKNOWN','FAILED') -and $delivery.recipientRef -eq $Request.correspondenceRef -and $null -ne $delivery.evidenceRef) 'DELIVERY_NOT_RECORDED'
    if ($delivery.status -eq 'DELIVERED') {
        Require ($delivery.proofCode -in @('RECIPIENT_ACKNOWLEDGEMENT','PROVIDER_DELIVERY_VERIFIED','AUTHENTICATED_DOWNLOAD') -and $null -eq $delivery.followupAt) 'DELIVERY_PROOF_REQUIRED'
        if ($delivery.proofCode -eq 'AUTHENTICATED_DOWNLOAD') { Require ($delivery.channelCode -eq 'AUTHENTICATED_ACCOUNT') 'DELIVERY_CHANNEL_CONFLICT' }
        return
    }
    Require ($null -ne $delivery.administrativeClosureReason -and $null -ne $delivery.followupAt) 'ADMINISTRATIVE_REASON_REQUIRED'
    if ($delivery.status -eq 'UNKNOWN') { Require ($delivery.proofCode -in @('PROVIDER_ACCEPTED','SENT','NO_CONFIRMATION')) 'DELIVERY_STATUS_CONFLICT' }
    if ($delivery.status -eq 'FAILED') { Require ($delivery.proofCode -eq 'DELIVERY_FAILURE') 'DELIVERY_STATUS_CONFLICT' }
    $linkedId=$delivery.administrativeClosureReason.dependencyId
    Require (@($Request.dependencies | Where-Object { $_.id -eq $linkedId -and $_.type -eq 'DELIVERY' -and $_.status -in @('OPEN','WAITING') -and $_.nextActionAt -eq $delivery.followupAt -and $_.ownerRole -eq $script:Role }).Count -eq 1) 'DELIVERY_FOLLOWUP_REQUIRED'
}
function Apply-PrivacyAction([object]$Store,[object]$Action,[string]$Now) {
    Validate-Dates $Action
    $digest = Digest $Action
    $old = @($Store.events | Where-Object id -eq $Action.eventId)
    if ($old.Count -gt 0) { Require ($old.Count -eq 1 -and $old[0].operationDigest -eq $digest) 'EVENT_ID_CONFLICT'; return @{replayed=$true; revision=$Store.revision} }
    Require ($Store.revision -eq $Action.expectedRevision) 'REVISION_CONFLICT'
    Require (($Action.operation -eq 'retire' -or $Store.events.Count -lt 10000) -and $Store.requests.Count -le 1000) 'RECORD_LIMIT'
    $from = $null; $r = $null
    if ($Action.operation -ne 'create') { $r = Get-Request $Store $Action.requestId; $from = $r.state }
    if ($null -ne $r) { Assert-ClosedObligations $r }
    switch ($Action.operation) {
        'create' {
            Require ($Store.requests.Count -lt 1000) 'RECORD_LIMIT'
            Require (@($Store.requests | Where-Object id -eq $Action.requestId).Count -eq 0) 'REQUEST_EXISTS'
            Fresh-Date $Action.nextActionAt $Now; Fresh-Date $Action.reviewAt $Now
            Require ((Instant $Action.receivedAt) -le (Instant $Now)) 'FUTURE_RECEIPT'
            Require (($null -eq $Action.legalDueAt -and $null -eq $Action.legalSourceRef) -or ($null -ne $Action.legalDueAt -and $null -ne $Action.legalSourceRef)) 'LEGAL_SOURCE_REQUIRED'
            $r = @{id=$Action.requestId; kinds=$Action.kinds; receivedAt=$Action.receivedAt; ownerRole=$script:Role; subjectRef=$Action.subjectRef; correspondenceRef=$Action.correspondenceRef; scopeRef=$Action.scopeRef; scopeCodes=$Action.scopeCodes; state='RECEIVED'; verification=$null; authorizationRef=$null; assessmentRef=$null; nextActionAt=$Action.nextActionAt; processingResults=@(); dependencies=@(); delivery=@{status='NOT_ATTEMPTED'; channelCode=$null; recipientRef=$null; proofCode=$null; evidenceRef=$null; followupAt=$null; administrativeClosureReason=$null}; retention=@{reviewAt=$Action.reviewAt; reasonCode='PERIODIC_REVIEW'; disposition='RETAIN'}; legalDueAt=$Action.legalDueAt; legalSourceRef=$Action.legalSourceRef}
            Reset-Verification $r; Reset-Results $r; $Store.requests += ,$r
        }
        'verify' {
            Require ($r.state -in @('VERIFYING','ASSESSING')) 'STATE_FORBIDDEN'; Scope-Matches $r $Action
            Require ($Action.status -ne 'NOT_REQUIRED' -or (Is-Information $r)) 'VERIFICATION_REQUIRED'
            Require ($Action.status -ne 'VERIFIED' -or ($null -ne $r.subjectRef -and $Action.methodCode -in @('AUTHENTICATED_RECENT','REVIEWED_ALTERNATIVE'))) 'VERIFICATION_REQUIRED'
            Require ($Action.status -ne 'NOT_REQUIRED' -or $Action.methodCode -eq 'INFORMATION_ONLY') 'VERIFICATION_REQUIRED'
            $r.verification = @{status=$Action.status; methodCode=$Action.methodCode; verifiedAt=$Now; subjectRef=$r.subjectRef; scopeRef=$r.scopeRef; scopeDigest=(Digest $r.scopeCodes); evidenceRef=$Action.evidenceRef}
            $r.authorizationRef=$null; $r.assessmentRef=$null
        }
        'reset-scope' {
            Require ($r.state -notin @('CLOSED_COMPLETE','CLOSED_LIMITED','WITHDRAWN')) 'REOPEN_REQUIRED'
            Require ($r.scopeRef -ne $Action.scopeRef) 'NEW_SCOPE_REFERENCE_REQUIRED'
            $removed = @($r.scopeCodes | Where-Object { $_ -notin $Action.scopeCodes })
            Require ((Digest @($removed | Sort-Object)) -eq (Digest @($Action.removedScopeCodes | Sort-Object))) 'SCOPE_DISPOSITION_REQUIRED'
            $r.subjectRef=$Action.subjectRef; $r.scopeRef=$Action.scopeRef; $r.scopeCodes=$Action.scopeCodes; $r.state='VERIFYING'; Reset-Verification $r; Reset-Results $r; Reset-Delivery $r
            foreach ($d in $r.dependencies) { $d.status='OPEN'; $d.nextActionAt=$Action.nextActionAt; $d.evidenceRef=$null; $d.reasonCode='RECHECK_REQUIRED' }
        }
        'assess' {
            Require ($r.state -eq 'ASSESSING') 'STATE_FORBIDDEN'; Scope-Matches $r $Action
            Require (Verification-Ready $r) 'VERIFICATION_REQUIRED'; Dependency-Ready $r
            $r.assessmentRef=$Action.evidenceRef
        }
        'execute-start' {
            Require ($r.state -in @('ASSESSING','CHECKING','EXECUTING','ESCALATED')) 'STATE_FORBIDDEN'
            Scope-Matches $r $Action; Require (Verification-Ready $r) 'VERIFICATION_REQUIRED'
            Require ($null -ne $r.assessmentRef) 'ASSESSMENT_REQUIRED'; Dependency-Ready $r
            Require ($r.state -ne 'ESCALATED' -or $null -ne $Action.decisionRef) 'ESCALATION_DECISION_REQUIRED'
            Require ($r.state -ne 'EXECUTING' -or $Action.reasonCode -eq 'STATE_INSPECTED_RETRY') 'RETRY_INSPECTION_REQUIRED'
            $r.authorizationRef=$Action.authorizationRef; $r.state='EXECUTING'
            Reset-Results $r; Reset-Delivery $r
        }
        'result' {
            Require ($r.state -in @('EXECUTING','CHECKING')) 'STATE_FORBIDDEN'; Scope-Matches $r $Action
            Require (Verification-Ready $r) 'VERIFICATION_REQUIRED'
            Require ((Is-Information $r) -or $null -ne $r.authorizationRef) 'AUTHORIZATION_REQUIRED'
            Require ($Action.scopeCode -in $r.scopeCodes) 'SCOPE_MISMATCH'
            if ($Action.status -eq 'NOT_APPLICABLE') { Require ($Action.reasonCode -eq 'JUSTIFIED_NOT_APPLICABLE') 'APPLICABILITY_REQUIRED' }
            if ($Action.status -in @('FAILED','UNVERIFIED')) { Require ($null -ne $Action.dependencyId -and @($r.dependencies | Where-Object { $_.id -eq $Action.dependencyId -and $_.status -in @('OPEN','WAITING') }).Count -eq 1) 'ACTIVE_DEPENDENCY_REQUIRED' }
            $r.processingResults = @($r.processingResults | ForEach-Object { if ($_.scopeCode -eq $Action.scopeCode) { @{scopeCode=$Action.scopeCode; status=$Action.status; evidenceRef=$Action.evidenceRef; reasonCode=$Action.reasonCode; dependencyId=$Action.dependencyId} } else { $_ } })
        }
        'dependency' {
            Require ($r.state -ne 'RECEIVED') 'STATE_FORBIDDEN'
            $existing = @($r.dependencies | Where-Object id -eq $Action.dependency.id)
            Require ($existing.Count -le 1) 'DEPENDENCY_CONFLICT'
            Require (-not ($r.state -in @('CLOSED_COMPLETE','CLOSED_LIMITED') -and $existing.Count -eq 0)) 'REOPEN_REQUIRED'
            if ($existing.Count -eq 1) { Require ($existing[0].type -eq $Action.dependency.type -and $existing[0].providerCode -eq $Action.dependency.providerCode) 'DEPENDENCY_ID_CONFLICT' }
            $d=$Action.dependency
            Require (-not ($r.state -eq 'CLOSED_COMPLETE' -and $d.type -ne 'DELIVERY' -and $d.status -in @('OPEN','WAITING'))) 'REOPEN_REQUIRED'
            if ($d.status -in @('OPEN','WAITING')) { Fresh-Date $d.nextActionAt $Now }
            else { Require ($null -ne $d.evidenceRef -and $d.reasonCode -ne 'PENDING') 'DEPENDENCY_EVIDENCE_REQUIRED'; Require ($d.status -ne 'NOT_APPLICABLE' -or $d.reasonCode -eq 'JUSTIFIED_NOT_APPLICABLE') 'APPLICABILITY_REQUIRED' }
            if ($d.type -eq 'PROVIDER') { Require ($null -ne $d.providerCode) 'PROVIDER_REQUIRED' }
            $r.dependencies = @($r.dependencies | Where-Object id -ne $d.id) + @($d)
            Require ($r.dependencies.Count -le 100) 'RECORD_LIMIT'
        }
        'delivery' {
            Require ($r.state -in @('CHECKING','CLOSED_COMPLETE','CLOSED_LIMITED','WITHDRAWN')) 'STATE_FORBIDDEN'
            Require ($Action.recipientRef -eq $r.correspondenceRef) 'RECIPIENT_MISMATCH'
            Require (-not ($r.state -in @('CLOSED_COMPLETE','CLOSED_LIMITED') -and $Action.status -ne 'DELIVERED')) 'REOPEN_REQUIRED'
            if ($Action.status -eq 'FAILED') { Require ($Action.proofCode -eq 'DELIVERY_FAILURE') 'DELIVERY_STATUS_CONFLICT' }
            if ($Action.status -eq 'PENDING') { Require ($Action.proofCode -eq 'PENDING_CONFIRMATION') 'DELIVERY_STATUS_CONFLICT' }
            if ($Action.status -eq 'UNKNOWN') { Require ($Action.proofCode -in @('PROVIDER_ACCEPTED','SENT','NO_CONFIRMATION')) 'DELIVERY_STATUS_CONFLICT' }
            if ($Action.proofCode -eq 'AUTHENTICATED_DOWNLOAD') { Require ($Action.channelCode -eq 'AUTHENTICATED_ACCOUNT') 'DELIVERY_CHANNEL_CONFLICT' }
            if ($Action.status -eq 'DELIVERED') { Require ($Action.proofCode -in @('RECIPIENT_ACKNOWLEDGEMENT','PROVIDER_DELIVERY_VERIFIED','AUTHENTICATED_DOWNLOAD')) 'DELIVERY_PROOF_REQUIRED' }
            if ($Action.proofCode -in @('PROVIDER_ACCEPTED','SENT','NO_CONFIRMATION')) { Require ($Action.status -eq 'UNKNOWN') 'ACCEPTANCE_IS_NOT_DELIVERY' }
            if ($Action.status -ne 'DELIVERED') { Fresh-Date $Action.followupAt $Now; Require (@($r.dependencies | Where-Object { $_.type -eq 'DELIVERY' -and $_.status -in @('OPEN','WAITING') -and $_.nextActionAt -eq $Action.followupAt }).Count -gt 0) 'DELIVERY_FOLLOWUP_REQUIRED' }
            else { Require ($null -eq $Action.followupAt) 'DELIVERY_FOLLOWUP_CONFLICT' }
            $r.delivery=@{status=$Action.status; channelCode=$Action.channelCode; recipientRef=$Action.recipientRef; proofCode=$Action.proofCode; evidenceRef=$Action.evidenceRef; followupAt=$Action.followupAt; administrativeClosureReason=$null}
        }
        'transition' {
            $graph=@{RECEIVED=@('VERIFYING','WITHDRAWN'); VERIFYING=@('ASSESSING','ESCALATED','WITHDRAWN'); ASSESSING=@('CHECKING','ESCALATED','WITHDRAWN'); EXECUTING=@('CHECKING','ESCALATED','WITHDRAWN'); CHECKING=@('ASSESSING','CLOSED_COMPLETE','CLOSED_LIMITED','WITHDRAWN'); ESCALATED=@('VERIFYING','ASSESSING','CHECKING','WITHDRAWN'); CLOSED_COMPLETE=@('ASSESSING'); CLOSED_LIMITED=@('ASSESSING'); WITHDRAWN=@('VERIFYING')}
            Require ($Action.toState -in $graph[$r.state]) 'TRANSITION_FORBIDDEN'
            if ($r.state -eq 'ESCALATED') { Require ($null -ne $Action.decisionRef) 'ESCALATION_DECISION_REQUIRED' }
            if ($Action.toState -in @('ASSESSING','CHECKING') -and $r.state -in @('VERIFYING','ESCALATED','ASSESSING')) { Require (Verification-Ready $r) 'VERIFICATION_REQUIRED' }
            if ($r.state -eq 'ASSESSING' -and $Action.toState -eq 'CHECKING') { Require ((Is-Information $r) -and $null -ne $r.assessmentRef) 'INFORMATION_ONLY_REQUIRED' }
            if ($r.state -eq 'ESCALATED' -and $Action.toState -eq 'CHECKING') { Require ($null -ne $r.assessmentRef) 'ASSESSMENT_REQUIRED'; Require ((Is-Information $r) -or $null -ne $r.authorizationRef) 'AUTHORIZATION_REQUIRED' }
            if ($Action.toState -in @('CLOSED_COMPLETE','CLOSED_LIMITED')) {
                Require (Verification-Ready $r) 'VERIFICATION_REQUIRED'; Dependency-Ready $r
                Require (@($r.processingResults | Where-Object status -eq 'PENDING').Count -eq 0) 'PENDING_SCOPE'
                if ($Action.toState -eq 'CLOSED_COMPLETE') {
                    Require (@($r.processingResults | Where-Object { $_.status -notin @('VERIFIED','NOT_APPLICABLE') }).Count -eq 0) 'UNVERIFIED_SCOPE'
                    Require (@($r.dependencies | Where-Object { $_.type -ne 'DELIVERY' -and $_.status -in @('OPEN','WAITING') }).Count -eq 0) 'OPEN_DEPENDENCIES'
                } else { Require ($Action.reasonCode -eq 'LIMITED_SCOPE_RESULT') 'LIMITED_REASON_REQUIRED' }
                foreach ($outstanding in $r.processingResults) { if ($outstanding.status -in @('FAILED','UNVERIFIED')) { Require (@($r.dependencies | Where-Object { $_.id -eq $outstanding.dependencyId -and $_.status -in @('OPEN','WAITING') }).Count -eq 1) 'ACTIVE_DEPENDENCY_REQUIRED' } }
                foreach ($d in $r.dependencies) { if ($d.status -in @('OPEN','WAITING')) { Fresh-Date $d.nextActionAt $Now } }
                Require ($r.delivery.status -in @('DELIVERED','FAILED','UNKNOWN')) 'DELIVERY_NOT_RECORDED'
                if ($r.delivery.status -ne 'DELIVERED') {
                    Require ($null -ne $Action.administrativeReasonRef -and $null -ne $Action.deliveryDependencyId) 'ADMINISTRATIVE_REASON_REQUIRED'
                    $follow = @($r.dependencies | Where-Object { $_.id -eq $Action.deliveryDependencyId -and $_.type -eq 'DELIVERY' -and $_.status -in @('OPEN','WAITING') -and $_.nextActionAt -eq $r.delivery.followupAt })
                    Require ($follow.Count -eq 1) 'DELIVERY_FOLLOWUP_REQUIRED'
                    $r.delivery.administrativeClosureReason=@{reasonCode='DELIVERY_UNCONFIRMED'; evidenceRef=$Action.administrativeReasonRef; at=$Now; dependencyId=$Action.deliveryDependencyId}
                }
            }
            if ($r.state -in @('CLOSED_COMPLETE','CLOSED_LIMITED','WITHDRAWN')) { Reset-Verification $r; Reset-Results $r; $r.delivery=@{status='NOT_ATTEMPTED'; channelCode=$null; recipientRef=$null; proofCode=$null; evidenceRef=$null; followupAt=$null; administrativeClosureReason=$null}; foreach ($d in $r.dependencies) { $d.status='OPEN'; $d.nextActionAt=$Action.nextActionAt; $d.evidenceRef=$null; $d.reasonCode='RECHECK_REQUIRED' } }
            $r.state=$Action.toState
        }
        'retire' {
            Assert-ClosedObligations $r
            Require ($Action.reasonCode -eq 'RETENTION_COMPLETED') 'RETENTION_REVIEW_REQUIRED'
            Require ($r.state -in @('CLOSED_COMPLETE','CLOSED_LIMITED','WITHDRAWN')) 'CLOSED_REQUIRED'
            Require (@($r.dependencies | Where-Object { $_.status -in @('OPEN','WAITING') }).Count -eq 0) 'OPEN_DEPENDENCIES'
            Require ($r.delivery.status -eq 'DELIVERED' -or ($r.state -eq 'WITHDRAWN' -and $r.delivery.status -eq 'NOT_ATTEMPTED')) 'UNRESOLVED_DELIVERY'
            Require ((Instant $Action.reviewedAt) -le (Instant $Now) -and (Instant $Action.reviewedAt) -ge (Instant $r.receivedAt)) 'RETENTION_REVIEW_REQUIRED'
            foreach ($type in @('TEMPORARY_DETAIL','CORRESPONDENCE','BACKUP','RECOVERY_COPY')) { Require (@($Action.copies | Where-Object type -eq $type).Count -ge 1) 'COPY_INVENTORY_INCOMPLETE' }
            $Store.requests=@($Store.requests | Where-Object id -ne $r.id)
            $Store.events=@($Store.events | Where-Object requestId -ne $r.id)
            # Deliberately no request ID, old event ID, payload digest or external reference survives retirement.
            $Store.retirementCount++
        }
        default { Deny 'OPERATION_FORBIDDEN' }
    }
    if ($Action.operation -ne 'retire') {
        Assert-ClosedObligations $r
        Fresh-Date $Action.nextActionAt $Now; $r.nextActionAt=$Action.nextActionAt
        $Store.events += ,@{id=$Action.eventId; requestId=$r.id; actorRole=$script:Role; operation=$Action.operation; fromState=$from; toState=$r.state; reasonCode=$Action.reasonCode; at=$Now; correlationId=$Action.correlationId; evidenceRef=$Action.evidenceRef; operationDigest=$digest}
    }
    $Store.revision++; $Store.updatedAt=$Now
    Validate-Dates $Store
    return @{replayed=$false; revision=$Store.revision}
}





