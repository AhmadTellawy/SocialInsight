#requires -Version 7.5
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Domain.ps1')
$script:Entropy=[Text.Encoding]::UTF8.GetBytes('SocialInsight.PrivacyRegister.v1.CurrentUser')
function Assert-Windows { Require ($IsWindows) 'WINDOWS_REQUIRED' }
function Current-Sid { [Security.Principal.WindowsIdentity]::GetCurrent().User }
function New-PrivateAcl([bool]$Directory) {
    $sid=Current-Sid; $system=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $acl=if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false)
    $inherit=if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($identity in @($sid,$system)) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)) }
    return $acl
}
function Assert-NoReparse([string]$Path) {
    $cursor=[IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if ([IO.Directory]::Exists($cursor) -or [IO.File]::Exists($cursor)) { Require (([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'REPARSE_PATH_REJECTED' }
        Require (-not ([IO.Directory]::Exists((Join-Path $cursor '.git')) -or [IO.File]::Exists((Join-Path $cursor '.git')))) 'GIT_PATH_REJECTED'
        $parent=[IO.Directory]::GetParent($cursor); $cursor=if ($null -eq $parent) { $null } else { $parent.FullName }
    }
}
function Assert-PrivateAcl([string]$Path,[bool]$Directory) {
    Assert-NoReparse $Path
    $info=if ($Directory) { [IO.DirectoryInfo]::new($Path) } else { [IO.FileInfo]::new($Path) }
    $acl=[IO.FileSystemAclExtensions]::GetAccessControl($info)
    Require ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq (Current-Sid).Value -and $acl.AreAccessRulesProtected) 'FOREIGN_ACL'
    $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
    Require ($rules.Count -eq 2) 'FOREIGN_ACL'
    $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($rule in $rules) {
        Require ($rule.IdentityReference.Value -in @((Current-Sid).Value,'S-1-5-18') -and $seen.Add($rule.IdentityReference.Value) -and -not $rule.IsInherited -and $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rule.FileSystemRights -eq [Security.AccessControl.FileSystemRights]::FullControl -and $rule.PropagationFlags -eq [Security.AccessControl.PropagationFlags]::None) 'FOREIGN_ACL'
        $expected=if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
        Require ($rule.InheritanceFlags -eq $expected) 'FOREIGN_ACL'
    }
}
function Resolve-Store([string]$Mode,[string]$StoreDirectory) {
    Assert-Windows
    if ($Mode -eq 'OPERATIONAL') {
        $expected=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SocialInsightPrivacyRegister'
        if ($StoreDirectory) { Require ([IO.Path]::GetFullPath($StoreDirectory).Equals($expected,[StringComparison]::OrdinalIgnoreCase)) 'OPERATIONAL_PATH_FIXED' }
        $resolved=$expected
    } elseif ($Mode -eq 'SYNTHETIC') {
        Require (-not [string]::IsNullOrWhiteSpace($StoreDirectory)) 'SYNTHETIC_PATH_REQUIRED'
        $resolved=[IO.Path]::GetFullPath($StoreDirectory)
        $parent=[IO.Path]::GetDirectoryName($resolved)
        Require ($parent.TrimEnd('\').Equals([IO.Path]::GetTempPath().TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolved) -cmatch '^SocialInsightPrivacyRegister-Synthetic-[0-9a-f-]{36}$') 'SYNTHETIC_PATH_REQUIRED'
    } else { Deny 'MODE_REQUIRED' }
    Assert-NoReparse $resolved; return $resolved
}
function New-PrivateDirectory([string]$Path) {
    Require (-not ([IO.Directory]::Exists($Path) -or [IO.File]::Exists($Path))) 'PATH_EXISTS'
    Assert-NoReparse ([IO.Path]::GetDirectoryName($Path))
    [IO.FileSystemAclExtensions]::Create([IO.DirectoryInfo]::new($Path),(New-PrivateAcl $true))
    Assert-PrivateAcl $Path $true
}
function Create-PrivateFile([string]$Path,[byte[]]$Bytes) {
    $stream=[IO.FileSystemAclExtensions]::Create([IO.FileInfo]::new($Path),[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::FullControl,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,(New-PrivateAcl $false))
    try { $stream.Write($Bytes,0,$Bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    Assert-PrivateAcl $Path $false
}
function Assert-Root([string]$Root) {
    Assert-PrivateAcl $Root $true
    foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($Root)) {
        $name=[IO.Path]::GetFileName($entry)
        Require ($name -in @('register.bin','register.lock','commands')) 'UNRESOLVED_STORE_FILE'
        Assert-PrivateAcl $entry ($name -eq 'commands')
    }
    Assert-PrivateAcl (Join-Path $Root 'commands') $true
}
function Lock-Store([string]$Root) {
    Assert-Root $Root
    try { $lock=[IO.File]::Open((Join-Path $Root 'register.lock'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
    catch [IO.IOException] { Deny 'STORE_BUSY' }
    return $lock
}
function Protect-Bytes([byte[]]$Bytes) {
    Require ($Bytes.Length -le 8388608) 'SIZE_LIMIT'
    return ,[Security.Cryptography.ProtectedData]::Protect($Bytes,$script:Entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
}
function Read-Protected([string]$Path,[int]$Limit,[string]$Schema) {
    Assert-PrivateAcl $Path $false
    $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
    try { Require ($stream.Length -gt 0 -and $stream.Length -le ($Limit+65536)) 'SIZE_LIMIT'; $bytes=[byte[]]::new([int]$stream.Length); $stream.ReadExactly($bytes) } finally { $stream.Dispose() }
    try { $clear=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$script:Entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser) } catch { Deny 'CIPHERTEXT_REJECTED' }
    try { Require ($clear.Length -le $Limit) 'SIZE_LIMIT'; return Read-StrictJson $clear $Schema } finally { [Array]::Clear($clear,0,$clear.Length) }
}
function Assert-Envelope([object]$Store,[string]$Mode) {
    Require ($Store.mode -eq $Mode) 'MODE_MISMATCH'; Validate-Dates $Store
    $requestIds=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $eventIds=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($r in $Store.requests) {
        Require ($requestIds.Add($r.id)) 'DUPLICATE_REQUEST'
        Assert-ClosedObligations $r
        Require ((Digest @($r.scopeCodes | Sort-Object)) -eq (Digest @($r.processingResults.scopeCode | Sort-Object))) 'SCOPE_DRIFT'
        Require (@($r.dependencies | ForEach-Object id | Select-Object -Unique).Count -eq $r.dependencies.Count) 'DUPLICATE_DEPENDENCY'
        $history=@($Store.events | Where-Object requestId -eq $r.id)
        Require ($history.Count -gt 0 -and $history[-1].toState -eq $r.state) 'STATE_DRIFT'
    }
    foreach ($e in $Store.events) { Require ($eventIds.Add($e.id) -and $requestIds.Contains($e.requestId)) 'EVENT_DRIFT' }
}
function Read-Store([string]$Root,[string]$Mode) { $store=Read-Protected (Join-Path $Root 'register.bin') 8388608 'register.schema.json'; Assert-Envelope $store $Mode; return $store }
function Save-Store([string]$Root,[object]$Store,[bool]$Initial=$false) {
    $clear=[Text.Encoding]::UTF8.GetBytes((Json $Store))
    try { [void](Read-StrictJson $clear 'register.schema.json'); $cipher=Protect-Bytes $clear } finally { [Array]::Clear($clear,0,$clear.Length) }
    $target=Join-Path $Root 'register.bin'
    if ($Initial) { Create-PrivateFile $target $cipher; return }
    Assert-PrivateAcl $target $false
    $pending=Join-Path $Root ('pending-'+[guid]::NewGuid().ToString()+'.bin')
    Create-PrivateFile $pending $cipher
    # Failure leaves encrypted pending evidence and blocks subsequent access; never silently use an older copy.
    [IO.File]::Replace($pending,$target,[NullString]::Value,$false)
    Assert-PrivateAcl $target $false
}
function Status-Only([object]$Store,[bool]$Replayed=$false) {
    $states=@{}; foreach ($state in @('RECEIVED','VERIFYING','ASSESSING','EXECUTING','CHECKING','ESCALATED','CLOSED_COMPLETE','CLOSED_LIMITED','WITHDRAWN')) { $states[$state]=@($Store.requests | Where-Object state -eq $state).Count }
    return @{mode=$Store.mode;registerId=$Store.registerId;revision=$Store.revision;requestCount=$Store.requests.Count;eventCount=$Store.events.Count;retirementCount=$Store.retirementCount;states=$states;replayed=$Replayed}
}
function New-PrivacyRegisterInput {
    [CmdletBinding()]param([Parameter(Mandatory)][ValidateSet('SYNTHETIC','OPERATIONAL')][string]$Mode,[string]$StoreDirectory,[Parameter(Mandatory)][object]$InputObject)
    $root=Resolve-Store $Mode $StoreDirectory; $lock=Lock-Store $root
    try {
        $store=Read-Store $root $Mode
        $clear=[Text.Encoding]::UTF8.GetBytes((Json $InputObject))
        try { Require ($clear.Length -le 65536) 'SIZE_LIMIT'; $action=Read-StrictJson $clear 'command.schema.json'; Validate-Dates $action; Require ($action.mode -eq $Mode -and $action.registerId -eq $store.registerId) 'REGISTER_BINDING_MISMATCH'; $cipher=Protect-Bytes $clear } finally { [Array]::Clear($clear,0,$clear.Length) }
        $commands=Join-Path $root 'commands'; Require (@([IO.Directory]::EnumerateFileSystemEntries($commands)).Count -lt 100) 'INPUT_LIMIT'
        $path=Join-Path $commands ([guid]::NewGuid().ToString()+'.bin'); Create-PrivateFile $path $cipher
        return $path
    } finally { $lock.Dispose() }
}
function Invoke-PrivacyRegister {
    [CmdletBinding()]param([Parameter(Mandatory)][ValidateSet('init','apply','status')][string]$Command,[Parameter(Mandatory)][ValidateSet('SYNTHETIC','OPERATIONAL')][string]$Mode,[string]$StoreDirectory,[string]$InputFile)
    $root=Resolve-Store $Mode $StoreDirectory
    if ($Command -eq 'init') {
        New-PrivateDirectory $root; New-PrivateDirectory (Join-Path $root 'commands'); Create-PrivateFile (Join-Path $root 'register.lock') ([byte[]]::new(0))
        $lock=Lock-Store $root
        try { $store=@{schemaVersion=1;mode=$Mode;registerId=[guid]::NewGuid().ToString();revision=0;updatedAt=[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');requests=@();events=@();retirementCount=0}; Save-Store $root $store $true; return Status-Only $store } finally { $lock.Dispose() }
    }
    $lock=Lock-Store $root
    try {
        $store=Read-Store $root $Mode
        if ($Command -eq 'status') { return Status-Only $store }
        Require (-not [string]::IsNullOrWhiteSpace($InputFile)) 'PROTECTED_INPUT_REQUIRED'
        $inputPath=[IO.Path]::GetFullPath($InputFile)
        Require ([IO.Path]::GetDirectoryName($inputPath).Equals((Join-Path $root 'commands'),[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($inputPath) -cmatch '^[0-9a-f-]{36}\.bin$') 'PROTECTED_INPUT_REQUIRED'
        $action=Read-Protected $inputPath 65536 'command.schema.json'
        Require ($action.mode -eq $Mode -and $action.registerId -eq $store.registerId) 'REGISTER_BINDING_MISMATCH'
        $outcome=Apply-PrivacyAction $store $action ([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'))
        if (-not $outcome.replayed) {
            Assert-Envelope $store $Mode
            if ($action.operation -eq 'retire') {
                # Remove only encrypted command copies belonging to this exact request, before committing retirement.
                foreach ($file in [IO.Directory]::EnumerateFiles((Join-Path $root 'commands'))) { $saved=Read-Protected $file 65536 'command.schema.json'; if ($saved.requestId -eq $action.requestId) { [IO.File]::Delete($file) } }
            }
            Save-Store $root $store
        }
        if ([IO.File]::Exists($inputPath)) { [IO.File]::Delete($inputPath) }
        return Status-Only $store $outcome.replayed
    } finally { $lock.Dispose() }
}
function Inspection-Id([string]$Value) {
    Require ($Value -cmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') 'INSPECTION_ID_INVALID'
}
function Get-PrivacyRegisterInspection {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet('SYNTHETIC','OPERATIONAL')][string]$Mode,
        [string]$StoreDirectory,
        [Parameter(Mandatory)][string]$RegisterId,
        [Parameter(Mandatory)][ValidateSet('CASES','DUE','CASE','EVENTS','EVENT')][string]$Query,
        [string]$RequestId,
        [string]$EventId,
        [string]$ExpectedInputFile,
        [int]$Offset=0,
        [int]$Limit=50,
        [Nullable[long]]$ExpectedRevision,
        [Parameter(Mandatory)][ref]$Result
    )
    # A mandatory reference output prevents uncaptured calls from printing case data.
    $Result.Value=$null
    Inspection-Id $RegisterId
    Require ($Offset -ge 0 -and $Offset -le 10000 -and $Limit -ge 1 -and $Limit -le 100) 'INSPECTION_LIMIT_INVALID'
    Require ($Offset -eq 0 -or $null -ne $ExpectedRevision) 'SNAPSHOT_REVISION_REQUIRED'
    if ($Query -in @('CASE','EVENTS','EVENT')) { Inspection-Id $RequestId }
    else { Require (-not $RequestId) 'INSPECTION_QUERY_INVALID' }
    if ($Query -eq 'EVENT') { Inspection-Id $EventId }
    else { Require (-not $EventId -and -not $ExpectedInputFile) 'INSPECTION_QUERY_INVALID' }
    if ($Query -in @('CASE','EVENT')) { Require ($Offset -eq 0 -and $Limit -eq 50) 'INSPECTION_QUERY_INVALID' }
    $root=Resolve-Store $Mode $StoreDirectory; $lock=Lock-Store $root
    try {
        $store=Read-Store $root $Mode
        Require ($store.registerId -eq $RegisterId) 'REGISTER_BINDING_MISMATCH'
        Require ($null -eq $ExpectedRevision -or $store.revision -eq $ExpectedRevision) 'REVISION_CONFLICT'
        $now=[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        $inspection=@{registerId=$store.registerId;revision=$store.revision;capturedAt=$now;query=$Query;status='FOUND';total=0;offset=$Offset;nextOffset=$null;entries=@();case=$null;event=$null;eventOutcome=$null}
        switch ($Query) {
            { $_ -in @('CASES','DUE') } {
                $entries=@()
                foreach ($request in ($store.requests | Sort-Object id)) {
                    $open=@($request.dependencies | Where-Object { $_.status -in @('OPEN','WAITING') })
                    $pending=$request.state -in $script:ActiveStates -or $open.Count -gt 0 -or $request.delivery.status -in @('PENDING','UNKNOWN','FAILED')
                    $dueReasons=@();$dueDates=@()
                    if ($pending -and (Instant $request.nextActionAt) -le (Instant $now)) { $dueReasons+='NEXT_ACTION';$dueDates+=$request.nextActionAt }
                    foreach ($dependency in $open) { if ($null -ne $dependency.nextActionAt -and (Instant $dependency.nextActionAt) -le (Instant $now)) { $dueReasons+='DEPENDENCY_FOLLOWUP';$dueDates+=$dependency.nextActionAt } }
                    if ($request.delivery.status -in @('PENDING','UNKNOWN','FAILED') -and $null -ne $request.delivery.followupAt -and (Instant $request.delivery.followupAt) -le (Instant $now)) { $dueReasons+='DELIVERY_FOLLOWUP';$dueDates+=$request.delivery.followupAt }
                    if ((Instant $request.retention.reviewAt) -le (Instant $now)) { $dueReasons+='RETENTION_REVIEW';$dueDates+=$request.retention.reviewAt }
                    if ($pending -and $null -ne $request.legalDueAt -and (Instant $request.legalDueAt) -le (Instant $now)) { $dueReasons+='LEGAL_DUE';$dueDates+=$request.legalDueAt }
                    if ($Query -eq 'DUE' -and $dueReasons.Count -eq 0) { continue }
                    $entries+=@{requestId=$request.id;state=$request.state;kinds=$request.kinds;scopeCodes=$request.scopeCodes;nextActionAt=$request.nextActionAt;reviewAt=$request.retention.reviewAt;legalDueAt=$request.legalDueAt;deliveryStatus=$request.delivery.status;openDependencyCount=$open.Count;dueReasons=@($dueReasons | Select-Object -Unique);dueAt=$(if($dueDates.Count -gt 0){@($dueDates | Sort-Object)[0]}else{$null})}
                }
                if ($Query -eq 'DUE') { $entries=@($entries | Sort-Object dueAt,requestId) }
                $inspection.total=$entries.Count
                $inspection.entries=@($entries | Select-Object -Skip $Offset -First $Limit)
                if (($Offset+$inspection.entries.Count) -lt $entries.Count) { $inspection.nextOffset=$Offset+$inspection.entries.Count }
            }
            'CASE' {
                $found=@($store.requests | Where-Object id -eq $RequestId)
                if ($found.Count -eq 0) { $inspection.status='NOT_FOUND' } else { $inspection.total=1;$inspection.case=$found[0] }
            }
            'EVENTS' {
                if (@($store.requests | Where-Object id -eq $RequestId).Count -eq 0) { $inspection.status='NOT_FOUND' }
                else {
                    $entries=@($store.events | Where-Object requestId -eq $RequestId)
                    $inspection.total=$entries.Count;$inspection.entries=@($entries | Select-Object -Skip $Offset -First $Limit)
                    if (($Offset+$inspection.entries.Count) -lt $entries.Count) { $inspection.nextOffset=$Offset+$inspection.entries.Count }
                }
            }
            'EVENT' {
                $expectedDigest=$null
                if ($ExpectedInputFile) {
                    $inputPath=[IO.Path]::GetFullPath($ExpectedInputFile)
                    Require ([IO.Path]::GetDirectoryName($inputPath).Equals((Join-Path $root 'commands'),[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($inputPath) -cmatch '^[0-9a-f-]{36}\.bin$') 'PROTECTED_INPUT_REQUIRED'
                    $action=Read-Protected $inputPath 65536 'command.schema.json'
                    Validate-Dates $action
                    Require ($action.mode -eq $Mode -and $action.registerId -eq $RegisterId -and $action.requestId -eq $RequestId -and $action.eventId -eq $EventId) 'INSPECTION_ACTION_BINDING_MISMATCH'
                    $expectedDigest=Digest $action
                }
                $found=@($store.events | Where-Object { $_.id -eq $EventId -and $_.requestId -eq $RequestId })
                if ($found.Count -eq 0) { $inspection.status='NOT_FOUND';$inspection.eventOutcome='NOT_FOUND' }
                else {
                    $inspection.total=1;$inspection.event=$found[0]
                    $inspection.eventOutcome=if ($null -eq $expectedDigest) { 'RECORDED' } elseif ($found[0].operationDigest -eq $expectedDigest) { 'RECORDED_EXACT' } else { 'RECORDED_CONFLICT' }
                }
            }
        }
    } finally { $lock.Dispose() }
    $Result.Value=$inspection
}
Export-ModuleMember -Function Invoke-PrivacyRegister,New-PrivacyRegisterInput,Get-PrivacyRegisterInspection





