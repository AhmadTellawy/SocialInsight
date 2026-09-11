#requires -Version 7.5
[CmdletBinding()]param([Parameter(Mandatory)][string]$EvidenceDirectory,[string]$TestFilter='.*')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$module=Import-Module (Join-Path $PSScriptRoot 'Register.psm1') -Force -PassThru
$results=[Collections.Generic.List[object]]::new(); $roots=[Collections.Generic.List[string]]::new()
$runtimePaths=@([Environment]::ProcessPath,[Security.Cryptography.ProtectedData].Assembly.Location,[IO.FileSystemAclExtensions].Assembly.Location,[System.Text.Json.JsonDocument].Assembly.Location);$runtimeBefore=@($runtimePaths | ForEach-Object { @{file=[IO.Path]::GetFileName($_);sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()} });$operationalPath=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SocialInsightPrivacyRegister';$operationalExistedBefore=Test-Path -LiteralPath $operationalPath
$runStarted=[DateTime]::UtcNow; $runClock=[Diagnostics.Stopwatch]::StartNew(); $assertions=0
$before=@(); foreach ($file in Get-ChildItem -LiteralPath $PSScriptRoot -File | Sort-Object Name) { $before+=@{path=$file.Name;bytes=$file.Length;sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} }
$before | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'closure-privacy-register-r2-before.json')
function Id { [guid]::NewGuid().ToString() }
function Stamp([int]$Days=0) { [DateTime]::UtcNow.AddDays($Days).ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
function Check([bool]$Value,[string]$Code) { $script:assertions++; if (-not $Value) { throw "ASSERT_$Code" } }
function Reject([scriptblock]$Body,[string]$Code) {
    $caught=$false
    try { & $Body | Out-Null } catch { $caught=$true; Check ($_.Exception.Message -eq $Code) ('EXPECTED_'+$Code+'_GOT_'+($_.Exception.Message -replace '[^A-Z_]','')) }
    Check $caught ('REJECTION_'+$Code)
}
function Fixture([string]$Kind='ERASE',[string[]]$Scopes=@('ACCOUNT')) {
    $script:root=Join-Path ([IO.Path]::GetTempPath()) ('SocialInsightPrivacyRegister-Synthetic-'+(Id)); $roots.Add($script:root)
    $script:status=Invoke-PrivacyRegister -Command init -Mode SYNTHETIC -StoreDirectory $script:root
    $script:requestId=Id; $script:subjectId=Id; $script:scopeId=Id; $script:correspondenceId=Id
    $script:dependencyIds=@{PROVIDER=(Id);BACKUP=(Id);STORAGE=(Id);DELIVERY=(Id)}
    $create=Action 'create' @{kinds=@($Kind);receivedAt=(Stamp);subjectRef=$script:subjectId;correspondenceRef=$script:correspondenceId;scopeRef=$script:scopeId;scopeCodes=$Scopes;reviewAt=(Stamp 7);legalDueAt=$null;legalSourceRef=$null}
    Apply $create; return $create
}
function Action([string]$Operation,[hashtable]$Fields=@{}) {
    $a=@{mode='SYNTHETIC';registerId=$script:status.registerId;expectedRevision=$script:status.revision;eventId=(Id);requestId=$script:requestId;correlationId=(Id);evidenceRef=(Id);reasonCode='STATE_CHANGE';nextActionAt=(Stamp 2);operation=$Operation}
    foreach ($key in $Fields.Keys) { $a[$key]=$Fields[$key] }; return $a
}
function Apply([object]$Action) {
    $file=New-PrivacyRegisterInput -Mode SYNTHETIC -StoreDirectory $script:root -InputObject $Action
    $script:status=Invoke-PrivacyRegister -Command apply -Mode SYNTHETIC -StoreDirectory $script:root -InputFile $file
}
function Read-Case { $inspection=$null; Get-PrivacyRegisterInspection -Mode SYNTHETIC -StoreDirectory $script:root -RegisterId $script:status.registerId -Query CASE -RequestId $script:requestId -Result ([ref]$inspection); return $inspection.case }
function Read-All { & $module {param($p) Read-Store $p 'SYNTHETIC'} $script:root }
function Transition([string]$To,[hashtable]$Extra=@{}) { $fields=@{toState=$To;decisionRef=$null;administrativeReasonRef=$null;deliveryDependencyId=$null}; foreach($key in $Extra.Keys){$fields[$key]=$Extra[$key]}; Apply (Action 'transition' $fields) }
function Verify([string]$State='VERIFIED',[string]$Method='AUTHENTICATED_RECENT') { Apply (Action 'verify' @{subjectRef=$script:subjectId;scopeRef=$script:scopeId;status=$State;methodCode=$Method}) }
function Dependency([string]$Type,[string]$State='NOT_APPLICABLE') {
    $d=@{id=$script:dependencyIds[$Type];type=$Type;providerCode=$(if($Type -eq 'PROVIDER'){'SUPABASE'}else{$null});status=$State;ownerRole='FOUNDER_PRIVACY_HANDLER';nextActionAt=$(if($State -in @('OPEN','WAITING')){$script:next}else{$null});evidenceRef=$(if($State -in @('OPEN','WAITING')){$null}else{Id});reasonCode=$(if($State -eq 'NOT_APPLICABLE'){'JUSTIFIED_NOT_APPLICABLE'}elseif($State -eq 'VERIFIED'){'DEPENDENCY_VERIFIED'}else{'PENDING'})}
    Apply (Action 'dependency' @{dependency=$d})
}
function Assess { Apply (Action 'assess' @{subjectRef=$script:subjectId;scopeRef=$script:scopeId}) }
function Execute { Apply (Action 'execute-start' @{subjectRef=$script:subjectId;scopeRef=$script:scopeId;authorizationRef=(Id);decisionRef=$null;reasonCode='AUTHORIZED_EXECUTION'}) }
function Result([string]$Scope='ACCOUNT',[string]$State='VERIFIED',[object]$Dependency=$null) { Apply (Action 'result' @{subjectRef=$script:subjectId;scopeRef=$script:scopeId;scopeCode=$Scope;status=$State;dependencyId=$Dependency;reasonCode=$(if($State -eq 'NOT_APPLICABLE'){'JUSTIFIED_NOT_APPLICABLE'}elseif($State -eq 'VERIFIED'){'PROCESSING_VERIFIED'}else{'PROCESSING_UNVERIFIED'})}) }
function Ready([string]$Kind='ERASE') {
    [void](Fixture $Kind); Transition VERIFYING; Verify; Transition ASSESSING
    foreach($type in @('PROVIDER','BACKUP','STORAGE')){Dependency $type}
    Assess; Execute
}
function Delivered { Apply (Action 'delivery' @{status='DELIVERED';channelCode='VERIFIED_EMAIL';recipientRef=$script:correspondenceId;proofCode='RECIPIENT_ACKNOWLEDGEMENT';followupAt=$null}) }
function Finish { Result; Transition CHECKING; Delivered; Transition CLOSED_COMPLETE }
function Retire-Action {
    $copies=@(); foreach($type in @('TEMPORARY_DETAIL','CORRESPONDENCE','BACKUP','RECOVERY_COPY')){$copies+=@{id=(Id);type=$type;status='VERIFIED_NO_REFERENCE';evidenceRef=(Id)}}
    return Action 'retire' @{reviewedAt=(Stamp);retentionDecisionRef=(Id);copyInventoryRef=(Id);inventoryComplete=$true;copies=$copies;reasonCode='RETENTION_COMPLETED'}
}
function Raw-Input([string]$Json) { & $module {param($p,$j) $path=Join-Path (Join-Path $p 'commands') ([guid]::NewGuid().ToString()+'.bin'); Create-PrivateFile $path (Protect-Bytes ([Text.Encoding]::UTF8.GetBytes($j))); return $path} $script:root $Json }
function Inspect([string]$Query,[hashtable]$Extra=@{}) {
    $inspection=$null
    Get-PrivacyRegisterInspection -Mode SYNTHETIC -StoreDirectory $script:root -RegisterId $script:status.registerId -Query $Query @Extra -Result ([ref]$inspection)
    return $inspection
}
function Cipher-Hash { (Get-FileHash -LiteralPath (Join-Path $script:root 'register.bin')).Hash }
function Check-Unchanged([string]$Hash,[object]$Before) {
    Check ((Cipher-Hash) -eq $Hash) 'CIPHERTEXT_UNCHANGED'
    $after=Read-All
    Check ($after.revision -eq $Before.revision -and (ConvertTo-Json $after.events -Depth 20 -Compress) -eq (ConvertTo-Json $Before.events -Depth 20 -Compress) -and (ConvertTo-Json $after.requests -Depth 30 -Compress) -eq (ConvertTo-Json $Before.requests -Depth 30 -Compress)) 'STORED_REVISION_EVENTS_RESULTS_UNCHANGED'
}
function Close-Unconfirmed([string]$Status='UNKNOWN') {
    Ready;Result;Transition CHECKING;$script:next=Stamp 2;Dependency DELIVERY OPEN
    Apply (Action 'delivery' @{status=$Status;channelCode='VERIFIED_EMAIL';recipientRef=$script:correspondenceId;proofCode=$(if($Status -eq 'UNKNOWN'){'SENT'}else{'DELIVERY_FAILURE'});followupAt=$script:next})
    Transition CLOSED_COMPLETE @{administrativeReasonRef=(Id);deliveryDependencyId=$script:dependencyIds.DELIVERY}
}
function Run-InspectionChild([string]$Body) {
    $modulePath=(Join-Path $PSScriptRoot 'Register.psm1').Replace("'","''")
    $rootLiteral=$script:root.Replace("'","''")
    $code="`$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;Import-Module '$modulePath';`$root='$rootLiteral';`$register='$($script:status.registerId)';`$script:checks=0;function ProbeCheck([bool]`$ok){`$script:checks++;if(-not `$ok){throw 'PROBE_CHECK_FAILED'}};try{`n"+$Body+"`n[Console]::WriteLine((ConvertTo-Json -Compress @{ok=`$true;checks=`$script:checks}));}catch{[Console]::Error.WriteLine('INSPECTION_PROBE_FAILED');exit 1}"
    $start=[Diagnostics.ProcessStartInfo]::new([Environment]::ProcessPath);$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
    foreach($arg in @('-NoLogo','-NoProfile','-EncodedCommand',[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code)))){$start.ArgumentList.Add($arg)}
    $child=[Diagnostics.Process]::Start($start)
    try {
        Check ($child.WaitForExit(30000)) 'INSPECTION_CHILD_TERMINATES'
        $out=$child.StandardOutput.ReadToEnd();$err=$child.StandardError.ReadToEnd()
        Check ($child.ExitCode -eq 0) 'INSPECTION_CHILD_EXIT'
        Check (-not $out.Contains($script:requestId) -and -not $err.Contains($script:requestId) -and -not $out.Contains('subjectRef') -and -not $out.Contains('correspondenceRef')) 'INSPECTION_CHILD_NO_CASE_STDOUT'
        $receipt=ConvertFrom-Json $out -AsHashtable;Check ($receipt.ok -and $receipt.checks -gt 0) 'INSPECTION_CHILD_RECEIPT';$script:assertions+=$receipt.checks
    } finally {$child.Dispose()}
}
function Run-Case([string]$Name,[scriptblock]$Body) {
    if ($Name -notmatch $TestFilter) { return }; $script:assertions=0; $clock=[Diagnostics.Stopwatch]::StartNew(); $errorCode=$null
    try { & $Body | Out-Null; $result='PASSED' } catch { $result='FAILED'; $errorCode=if($_.Exception.Message -cmatch '^[A-Z_]{3,180}$'){$_.Exception.Message}else{'HARNESS_OR_RUNTIME_ERROR_AT_LINE_'+$_.InvocationInfo.ScriptLineNumber+'_'+$_.FullyQualifiedErrorId+'_'+$_.ScriptStackTrace}; }
    $clock.Stop(); $results.Add(@{id='PR-'+($results.Count+1);name=$Name;result=$result;assertions=@{total=$script:assertions;passed=($script:assertions-$(if($result -eq 'FAILED' -and $script:assertions -gt 0){1}else{0}));failed=$(if($result -eq 'FAILED' -and $script:assertions -gt 0){1}else{0});skipped=0};duration_ms=[int]$clock.ElapsedMilliseconds;error=$errorCode})
    [Console]::WriteLine(('{0} {1}{2}' -f $result,$Name,$(if($errorCode){' '+$errorCode}else{''})))
}
try {
Run-Case 'CurrentUser DPAPI persisted restart and exact ACL, sanitized status' {
    [void](Fixture)
    $original=Read-All
    $bytes=[IO.File]::ReadAllBytes((Join-Path $script:root 'register.bin'))
    Check (-not [Text.Encoding]::UTF8.GetString($bytes).Contains($script:requestId)) 'NO_REQUEST_PLAINTEXT'
    Check (-not [Text.Encoding]::UTF8.GetString($bytes).Contains('FOUNDER_PRIVACY_HANDLER')) 'NO_LEDGER_PLAINTEXT'
    & $module {param($p) Assert-PrivateAcl $p $true; Assert-PrivateAcl (Join-Path $p 'register.bin') $false} $script:root
    Check $true 'EXACT_ACL'
    $output=& ([Environment]::ProcessPath) -NoLogo -NoProfile -File (Join-Path $PSScriptRoot 'register.ps1') -Command status -Mode SYNTHETIC -StoreDirectory $script:root
    Check ($LASTEXITCODE -eq 0) 'RESTART_EXIT'; $restarted=ConvertFrom-Json $output
    Check ($restarted.revision -eq 1 -and $restarted.requestCount -eq 1) 'RESTART_STATE'
    Check (-not ($output -join '').Contains($script:requestId)) 'NO_STATUS_CASE'
    Check (@([IO.Directory]::EnumerateFiles((Join-Path $script:root 'commands'))).Count -eq 0) 'INPUT_CONSUMED'
}
Run-Case 'Unknown field and direct identifier values fail before write' {
    $a=Fixture; $a.email='synthetic@example.invalid'; Reject {Apply $a} 'SCHEMA_INVALID'; $a.Remove('email')
    $a.eventId=Id; $a.subjectRef='synthetic@example.invalid'; Reject {Apply $a} 'SCHEMA_INVALID'
    $a.subjectRef='https://example.invalid/signed?token=synthetic'; Reject {Apply $a} 'SCHEMA_INVALID'
    Check ((Read-All).revision -eq 1) 'UNCHANGED'
}
Run-Case 'Duplicate and case-colliding JSON fields are rejected' {
    $a=Fixture; $json=ConvertTo-Json $a -Depth 20 -Compress
    foreach($field in @('eventId','EventId')){
        $bad=$json.Substring(0,$json.Length-1)+',"'+$field+'":"'+(Id)+'"}'
        $file=Raw-Input $bad; Reject {Invoke-PrivacyRegister -Command apply -Mode SYNTHETIC -StoreDirectory $script:root -InputFile $file} 'DUPLICATE_KEY'
    }
    Check ((Read-All).revision -eq 1) 'UNCHANGED'
}
Run-Case 'Actual ciphertext tampering fails without overwriting' {
    [void](Fixture); $path=Join-Path $script:root 'register.bin'; $bytes=[IO.File]::ReadAllBytes($path); $bytes[-3]=$bytes[-3] -bxor 1; [IO.File]::WriteAllBytes($path,$bytes)
    $hash=(Get-FileHash -LiteralPath $path).Hash; Reject {Invoke-PrivacyRegister -Command status -Mode SYNTHETIC -StoreDirectory $script:root} 'CIPHERTEXT_REJECTED'
    Check ((Get-FileHash -LiteralPath $path).Hash -eq $hash) 'NO_TAMPER_OVERWRITE'
}
Run-Case 'Foreign ACL is rejected and never repaired automatically' {
    [void](Fixture); $path=Join-Path $script:root 'register.bin'; $acl=[IO.FileSystemAclExtensions]::GetAccessControl([IO.FileInfo]::new($path),[Security.AccessControl.AccessControlSections]::Access); $original=[IO.FileSystemAclExtensions]::GetAccessControl([IO.FileInfo]::new($path),[Security.AccessControl.AccessControlSections]::Access)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),'Read','Allow')); [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($path),$acl)
    try {Reject {Invoke-PrivacyRegister -Command status -Mode SYNTHETIC -StoreDirectory $script:root} 'FOREIGN_ACL'; Check (@((Get-Acl -LiteralPath $path).Access).Count -eq 3) 'NOT_REPAIRED'} finally {[IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($path),$original)}
}
Run-Case 'Actual junction is rejected before data access' {
    [void](Fixture); $commands=Join-Path $script:root 'commands'; $hold=Join-Path $script:root 'held'; Move-Item -LiteralPath $commands -Destination $hold
    try { New-Item -ItemType Junction -Path $commands -Target $hold | Out-Null; Reject {& $module {param($p) Assert-NoReparse $p} $commands} 'REPARSE_PATH_REJECTED' } finally { if((Get-Item -LiteralPath $commands -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){Remove-Item -LiteralPath $commands -Force}; Move-Item -LiteralPath $hold -Destination $commands }
}
Run-Case 'Unverified execution and receipt-to-close jumps fail' {
    [void](Fixture); Reject {Execute} 'STATE_FORBIDDEN'; Reject {Transition CLOSED_COMPLETE} 'TRANSITION_FORBIDDEN'
    Transition VERIFYING; Reject {Transition ASSESSING} 'VERIFICATION_REQUIRED'; Verify FAILED; Reject {Transition ASSESSING} 'VERIFICATION_REQUIRED'
    Check ((Read-Case).state -eq 'VERIFYING') 'UNCHANGED_STATE'
}
Run-Case 'Other subject or scope cannot reuse verification and authorization' {
    Ready; $a=Action 'execute-start' @{subjectRef=(Id);scopeRef=$script:scopeId;authorizationRef=(Id);decisionRef=$null;reasonCode='STATE_INSPECTED_RETRY'}; Reject {Apply $a} 'SUBJECT_SCOPE_MISMATCH'
    $a.subjectRef=$script:subjectId; $a.scopeRef=Id; Reject {Apply $a} 'SUBJECT_SCOPE_MISMATCH'
    Check ((Read-Case).state -eq 'EXECUTING') 'SAME_STATE'
}
Run-Case 'ACCESS EXPORT CORRECT ERASE each complete validated recorded sequence' {
    foreach($kind in @('ACCESS','EXPORT','CORRECT','ERASE')){Ready $kind; Finish; Check ((Read-Case).state -eq 'CLOSED_COMPLETE') ('FLOW_'+$kind)}
}
Run-Case 'Information-only OTHER may record no verification required without execution' {
    [void](Fixture 'OTHER' @('INFORMATION')); Transition VERIFYING; Verify NOT_REQUIRED INFORMATION_ONLY; Transition ASSESSING
    foreach($type in @('PROVIDER','BACKUP','STORAGE')){Dependency $type}; Assess; Transition CHECKING; Result INFORMATION; Delivered; Transition CLOSED_COMPLETE
    Check ((Read-Case).authorizationRef -eq $null -and (Read-Case).state -eq 'CLOSED_COMPLETE') 'INFORMATION_FLOW'
}
Run-Case 'NOT_REQUIRED forbidden for personal rights and mixed OTHER scope' {
    [void](Fixture); Transition VERIFYING; Reject {Verify NOT_REQUIRED INFORMATION_ONLY} 'VERIFICATION_REQUIRED'
    [void](Fixture 'OTHER' @('INFORMATION','ACCOUNT')); Transition VERIFYING; Reject {Verify NOT_REQUIRED INFORMATION_ONLY} 'VERIFICATION_REQUIRED'
}
Run-Case 'Exact event replay is stable; conflicting event reuse and stale revision fail' {
    $a=Fixture; $before=(Read-All).revision; Apply $a; Check ($script:status.replayed -and $script:status.revision -eq $before) 'EXACT_REPLAY'
    $conflict=$a.Clone(); $conflict.evidenceRef=Id; Reject {Apply $conflict} 'EVENT_ID_CONFLICT'
    $stale=Action 'transition' @{toState='VERIFYING';decisionRef=$null;administrativeReasonRef=$null;deliveryDependencyId=$null}; $stale.expectedRevision=0; Reject {Apply $stale} 'REVISION_CONFLICT'
    Check ((Read-All).events.Count -eq 1) 'ONE_EVENT'
}
Run-Case 'Exclusive file lock denies concurrent readers and writers' {
    [void](Fixture); $lock=& $module {param($p) Lock-Store $p} $script:root
    try {Reject {Invoke-PrivacyRegister -Command status -Mode SYNTHETIC -StoreDirectory $script:root} 'STORE_BUSY'} finally {$lock.Dispose()}
    Check ((Read-All).revision -eq 1) 'LOCK_NO_CHANGE'
}
Run-Case 'Two actual CLI processes race without a lost update' {
    [void](Fixture)
    $a=Action 'transition' @{toState='VERIFYING';decisionRef=$null;administrativeReasonRef=$null;deliveryDependencyId=$null}
    $b=Action 'transition' @{toState='WITHDRAWN';decisionRef=$null;administrativeReasonRef=$null;deliveryDependencyId=$null}
    $inputs=@((New-PrivacyRegisterInput -Mode SYNTHETIC -StoreDirectory $script:root -InputObject $a),(New-PrivacyRegisterInput -Mode SYNTHETIC -StoreDirectory $script:root -InputObject $b));$children=@()
    foreach($inputPath in $inputs){$si=[Diagnostics.ProcessStartInfo]::new([Environment]::ProcessPath);$si.UseShellExecute=$false;$si.CreateNoWindow=$true;$si.RedirectStandardOutput=$true;$si.RedirectStandardError=$true;foreach($arg in @('-NoLogo','-NoProfile','-File',(Join-Path $PSScriptRoot 'register.ps1'),'-Command','apply','-Mode','SYNTHETIC','-StoreDirectory',$script:root,'-InputFile',$inputPath)){$si.ArgumentList.Add($arg)};$children+=[Diagnostics.Process]::Start($si)}
    $codes=@();foreach($child in $children){Check ($child.WaitForExit(30000)) 'RACE_TERMINATES';$codes+=$child.ExitCode;$out=$child.StandardOutput.ReadToEnd();$err=$child.StandardError.ReadToEnd();Check (-not $out.Contains($script:requestId) -and -not $err.Contains($script:requestId)) 'RACE_NO_PLAINTEXT';$child.Dispose()}
    Check (@($codes | Where-Object {$_ -eq 0}).Count -eq 1 -and @($codes | Where-Object {$_ -eq 1}).Count -eq 1) 'ONE_RACE_WINNER'
    Check ((Read-All).revision -eq 2 -and (Read-All).events.Count -eq 2) 'NO_LOST_UPDATE'
}
Run-Case 'Required provider storage backup inventory cannot be omitted' {
    [void](Fixture);Transition VERIFYING;Verify;Transition ASSESSING
    Reject {Assess} 'DEPENDENCY_INVENTORY_INCOMPLETE'; Dependency PROVIDER; Dependency STORAGE; Reject {Assess} 'DEPENDENCY_INVENTORY_INCOMPLETE'
    Check ((Read-Case).assessmentRef -eq $null) 'NO_ASSESSMENT'
}
Run-Case 'Each open provider storage backup blocks complete closure' {
    foreach($type in @('PROVIDER','STORAGE','BACKUP')){Ready;$script:next=Stamp 2;Dependency $type OPEN;Result;Transition CHECKING;Delivered;Reject {Transition CLOSED_COMPLETE} 'OPEN_DEPENDENCIES';Check ((Read-Case).state -eq 'CHECKING') ('BLOCKED_'+$type)}
}
Run-Case 'LIMITED preserves unresolved scope and owned dated obligations' {
    Ready;$script:next=Stamp 2;Dependency STORAGE WAITING;Result ACCOUNT UNVERIFIED $script:dependencyIds.STORAGE;Transition CHECKING;Delivered
    Reject {Transition CLOSED_COMPLETE} 'UNVERIFIED_SCOPE';Reject {Transition CLOSED_LIMITED} 'LIMITED_REASON_REQUIRED'
    Transition CLOSED_LIMITED @{reasonCode='LIMITED_SCOPE_RESULT'};$r=Read-Case;$d=@($r.dependencies|Where-Object type -eq STORAGE)[0]
    Check ($r.state -eq 'CLOSED_LIMITED' -and $d.status -eq 'WAITING' -and $d.nextActionAt -eq $script:next -and $d.ownerRole -eq 'FOUNDER_PRIVACY_HANDLER') 'OBLIGATIONS_PRESERVED'
    Reject {Apply (Retire-Action)} 'OPEN_DEPENDENCIES'
}
Run-Case 'Every requested scope needs an outcome and justified applicability' {
    [void](Fixture 'EXPORT' @('ACCOUNT','MEDIA'));Transition VERIFYING;Verify;Transition ASSESSING;foreach($type in @('PROVIDER','BACKUP','STORAGE')){Dependency $type};Assess;Execute;Result;Transition CHECKING;Delivered
    Reject {Transition CLOSED_COMPLETE} 'PENDING_SCOPE';$a=Action 'result' @{subjectRef=$script:subjectId;scopeRef=$script:scopeId;scopeCode='MEDIA';status='NOT_APPLICABLE';dependencyId=$null};Reject {Apply $a} 'APPLICABILITY_REQUIRED'
    Result MEDIA NOT_APPLICABLE;Transition CLOSED_COMPLETE;Check ((Read-Case).processingResults.Count -eq 2) 'NO_SCOPE_DROPPED'
}
Run-Case 'Sent and acceptance remain UNKNOWN; administrative closure requires followup' {
    Ready;Result;Transition CHECKING;$script:next=Stamp 2;Dependency DELIVERY OPEN
    $delivery=Action 'delivery' @{status='DELIVERED';channelCode='VERIFIED_EMAIL';recipientRef=$script:correspondenceId;proofCode='SENT';followupAt=$null};Reject {Apply $delivery} 'DELIVERY_PROOF_REQUIRED'
    $delivery.status='UNKNOWN';$delivery.followupAt=$script:next;Apply $delivery
    Reject {Transition CLOSED_COMPLETE} 'ADMINISTRATIVE_REASON_REQUIRED'
    Transition CLOSED_COMPLETE @{administrativeReasonRef=(Id);deliveryDependencyId=$script:dependencyIds.DELIVERY}
    $r=Read-Case;Check ($r.delivery.status -eq 'UNKNOWN' -and $null -ne $r.delivery.administrativeClosureReason.at -and @($r.dependencies|Where-Object status -eq OPEN).Count -eq 1) 'PROCESSING_SEPARATE'
    Reject {Apply (Retire-Action)} 'OPEN_DEPENDENCIES'
}
Run-Case 'Delivery proof must use the case recipient and unresolved delivery needs followup' {
    Ready;Result;Transition CHECKING
    $a=Action 'delivery' @{status='DELIVERED';channelCode='VERIFIED_EMAIL';recipientRef=(Id);proofCode='RECIPIENT_ACKNOWLEDGEMENT';followupAt=$null};Reject {Apply $a} 'RECIPIENT_MISMATCH'
    $a.recipientRef=$script:correspondenceId;$a.status='UNKNOWN';$a.proofCode='PROVIDER_ACCEPTED';$a.followupAt=Stamp 2;Reject {Apply $a} 'DELIVERY_FOLLOWUP_REQUIRED'
}
Run-Case 'Withdrawal records only; scope reset invalidates prior authority and does not drop scope silently' {
    Ready;Result;Transition WITHDRAWN;Check ((Read-Case).state -eq 'WITHDRAWN' -and (Read-Case).processingResults[0].status -eq 'VERIFIED') 'WITHDRAWAL_PRESERVES_PERFORMED_FACT'
    Transition VERIFYING;Check ((Read-Case).authorizationRef -eq $null -and (Read-Case).verification.status -eq 'UNVERIFIED') 'RESUMPTION_REVERIFIES'
    $newScope=Id;$a=Action 'reset-scope' @{subjectRef=(Id);scopeRef=$newScope;scopeCodes=@('MEDIA');removedScopeCodes=@()};Reject {Apply $a} 'SCOPE_DISPOSITION_REQUIRED'
    $a.removedScopeCodes=@('ACCOUNT');Apply $a;$r=Read-Case;Check ($r.state -eq 'VERIFYING' -and $r.verification.status -eq 'UNVERIFIED' -and $r.authorizationRef -eq $null -and $r.processingResults[0].status -eq 'PENDING') 'RESET_INVALIDATES'
    Check (@($r.dependencies|Where-Object status -ne OPEN).Count -eq 0) 'DEPENDENCIES_RECHECKED'
}
Run-Case 'Closed reopen rechecks all old outcomes; escalation needs recorded decision' {
    Ready;Finish;Transition ASSESSING;Reject {Execute} 'VERIFICATION_REQUIRED';Verify;Assess;Execute;Transition ESCALATED
    Reject {Transition CHECKING} 'ESCALATION_DECISION_REQUIRED';Transition CHECKING @{decisionRef=(Id)};Check ((Read-Case).state -eq 'CHECKING') 'ESCALATION_DECISION'
}
Run-Case 'Retention requires closed state and complete reviewed copy inventory' {
    Ready;Reject {Apply (Retire-Action)} 'CLOSED_REQUIRED';Finish;$a=Retire-Action;$a.copies=@($a.copies|Where-Object type -ne BACKUP);Reject {Apply $a} 'SCHEMA_INVALID'
    $a=Retire-Action;$a.copies[2].type='OTHER';Reject {Apply $a} 'COPY_INVENTORY_INCOMPLETE';Check ((Read-All).requests.Count -eq 1) 'RETAINED'
}
Run-Case 'Retirement removes every historical request reference and pending command copy' {
    Ready;Finish;$old=Read-All;$request=$script:requestId;$oldEventIds=@($old.events.id)
    $retire=Retire-Action;$retireInput=New-PrivacyRegisterInput -Mode SYNTHETIC -StoreDirectory $script:root -InputObject $retire
    $duplicate=New-PrivacyRegisterInput -Mode SYNTHETIC -StoreDirectory $script:root -InputObject $retire
    $script:status=Invoke-PrivacyRegister -Command apply -Mode SYNTHETIC -StoreDirectory $script:root -InputFile $retireInput
    $after=Read-All;$json=ConvertTo-Json $after -Depth 30 -Compress
    Check ($after.requests.Count -eq 0 -and $after.events.Count -eq 0 -and $after.retirementCount -eq 1) 'ONLY_COUNTER'
    Check (-not $json.Contains($request)) 'NO_REQUEST_REFERENCE';foreach($id in $oldEventIds){Check (-not $json.Contains($id)) 'NO_HISTORICAL_EVENT_REFERENCE'}
    Check (-not [IO.File]::Exists($duplicate) -and @([IO.Directory]::EnumerateFiles((Join-Path $script:root 'commands'))).Count -eq 0) 'COMMAND_COPIES_REMOVED'
    $exactBytes=ConvertTo-Json $retire -Depth 25 -Compress;Reject {Apply $retire} 'REVISION_CONFLICT';Check ((ConvertTo-Json $retire -Depth 25 -Compress) -eq $exactBytes) 'EXACT_RETIRE_BYTES_PRESERVED';
    $currentLookup=$retire.Clone();$currentLookup.expectedRevision=$after.revision;Reject {Apply $currentLookup} 'REQUEST_NOT_FOUND';Check ((Read-All).retirementCount -eq 1) 'RETIRE_RETRY_NO_RECREATE'
}
Run-Case 'Encrypted state drift and record limit fail closed without truncation' {
    [void](Fixture)
    & $module {param($p) $s=Read-Store $p 'SYNTHETIC';$s.requests[0].scopeCodes=@('MEDIA');Save-Store $p $s} $script:root
    Reject {Invoke-PrivacyRegister -Command status -Mode SYNTHETIC -StoreDirectory $script:root} 'SCOPE_DRIFT'
    [void](Fixture);$a=Action 'verify' @{subjectRef=('a'*70000);scopeRef=$script:scopeId;status='VERIFIED';methodCode='AUTHENTICATED_RECENT'};Reject {Apply $a} 'SIZE_LIMIT';Check ((Read-All).revision -eq 1) 'NO_TRUNCATION'
}
Run-Case 'Mode register binding legal source and invalid calendar dates fail closed' {
    [void](Fixture);$a=Action 'transition' @{toState='VERIFYING';decisionRef=$null;administrativeReasonRef=$null;deliveryDependencyId=$null};$a.registerId=Id;Reject {Apply $a} 'REGISTER_BINDING_MISMATCH';$a.registerId=$script:status.registerId;$a.mode='OPERATIONAL';Reject {Apply $a} 'REGISTER_BINDING_MISMATCH'
    $a=Fixture;$a.requestId=Id;$a.eventId=Id;$a.expectedRevision=$script:status.revision;$a.legalDueAt=Stamp 30;Reject {Apply $a} 'LEGAL_SOURCE_REQUIRED'
    $a.legalDueAt=$null;$a.receivedAt='2026-02-31T00:00:00.000Z';$caught=$false;try{Apply $a}catch{$caught=$true};Check $caught 'INVALID_CALENDAR'
}
Run-Case 'Scope and execution changes invalidate earlier delivery evidence' {
    Ready;Result;Transition CHECKING;Delivered
    Apply (Action 'execute-start' @{subjectRef=$script:subjectId;scopeRef=$script:scopeId;authorizationRef=(Id);decisionRef=$null;reasonCode='AUTHORIZED_EXECUTION'})
    Check ((Read-Case).delivery.status -eq 'NOT_ATTEMPTED') 'EXECUTION_REQUIRES_NEW_DELIVERY'
    Result;Transition CHECKING;Delivered
    Apply (Action 'reset-scope' @{subjectRef=$script:subjectId;scopeRef=(Id);scopeCodes=@('ACCOUNT','MEDIA');removedScopeCodes=@()})
    Check ((Read-Case).delivery.status -eq 'NOT_ATTEMPTED') 'SCOPE_REQUIRES_NEW_DELIVERY'
}
Run-Case 'Resolved dependency cannot strand an unverified LIMITED result' {
    Ready;$script:next=Stamp 2;Dependency STORAGE OPEN;Result ACCOUNT UNVERIFIED $script:dependencyIds.STORAGE;Transition CHECKING;Delivered;Dependency STORAGE VERIFIED
    Reject {Transition CLOSED_LIMITED @{reasonCode='LIMITED_SCOPE_RESULT'}} 'ACTIVE_DEPENDENCY_REQUIRED'
}
Run-Case 'Evidence applicability followup date and count exhaustion are explicit boundaries' {
    Ready;$script:next=Stamp -1;Reject {Dependency STORAGE OPEN} 'FOLLOWUP_DATE_REQUIRED'
    $d=@{id=$script:dependencyIds.STORAGE;type='STORAGE';providerCode=$null;status='VERIFIED';ownerRole='FOUNDER_PRIVACY_HANDLER';nextActionAt=$null;evidenceRef=$null;reasonCode='DEPENDENCY_VERIFIED'}
    Reject {Apply (Action 'dependency' @{dependency=$d})} 'DEPENDENCY_EVIDENCE_REQUIRED'
    $a=Action 'transition' @{toState='CHECKING';decisionRef=$null;administrativeReasonRef=$null;deliveryDependencyId=$null}
    Reject {& $module {param($p,$a) $s=Read-Store $p 'SYNTHETIC';$s.events=@($s.events[0])*10000;Apply-PrivacyAction $s $a ([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'))} $script:root $a} 'RECORD_LIMIT'
    Check ((Read-Case).state -eq 'EXECUTING') 'PERSISTED_STORE_UNCHANGED'
}
Run-Case 'R2 limited failed and unverified outcomes retain obligations until explicit reopen and recheck' {
    foreach($outcome in @('FAILED','UNVERIFIED')){
        Ready;$script:next=Stamp 2;Dependency STORAGE OPEN;Result ACCOUNT $outcome $script:dependencyIds.STORAGE;Transition CHECKING;Delivered;Transition CLOSED_LIMITED @{reasonCode='LIMITED_SCOPE_RESULT'}
        $before=Read-All;$hash=Cipher-Hash
        foreach($resolution in @('VERIFIED','NOT_APPLICABLE')){Reject {Dependency STORAGE $resolution} 'ACTIVE_DEPENDENCY_REQUIRED';Check-Unchanged $hash $before}
        Reject {Apply (Retire-Action)} 'OPEN_DEPENDENCIES';Check-Unchanged $hash $before
        Transition ASSESSING;Verify;Assess;Execute;foreach($type in @('PROVIDER','STORAGE','BACKUP')){Dependency $type VERIFIED};Finish
        Apply (Retire-Action);Check ((Read-All).retirementCount -eq 1) 'RECHECKED_CASE_RETIRES'
    }
}
Run-Case 'R2 closed UNKNOWN and FAILED delivery retain the exact active followup identity and date' {
    foreach($delivery in @('UNKNOWN','FAILED')){
        Close-Unconfirmed $delivery;$before=Read-All;$hash=Cipher-Hash
        foreach($resolution in @('VERIFIED','NOT_APPLICABLE')){Reject {Dependency DELIVERY $resolution} 'DELIVERY_FOLLOWUP_REQUIRED';Check-Unchanged $hash $before}
        $d=@((Read-Case).dependencies|Where-Object type -eq DELIVERY)[0].Clone();$d.id=Id
        Reject {Apply (Action 'dependency' @{dependency=$d})} 'REOPEN_REQUIRED';Check-Unchanged $hash $before
        $d.id=$script:dependencyIds.DELIVERY;$d.type='OTHER'
        Reject {Apply (Action 'dependency' @{dependency=$d})} 'DEPENDENCY_ID_CONFLICT';Check-Unchanged $hash $before
        $d.type='DELIVERY';$d.nextActionAt=Stamp 3
        Reject {Apply (Action 'dependency' @{dependency=$d})} 'DELIVERY_FOLLOWUP_REQUIRED';Check-Unchanged $hash $before
        $d.nextActionAt=$script:next;$d.ownerRole='OTHER'
        Reject {Apply (Action 'dependency' @{dependency=$d})} 'SCHEMA_INVALID';Check-Unchanged $hash $before
    }
}
Run-Case 'R2 actual delivery then followup resolution preserves earlier history and unrelated obligation' {
    Ready;Result;Transition CHECKING;$script:next=Stamp 2;Dependency STORAGE WAITING;Dependency DELIVERY OPEN
    Apply (Action 'delivery' @{status='UNKNOWN';channelCode='VERIFIED_EMAIL';recipientRef=$script:correspondenceId;proofCode='SENT';followupAt=$script:next})
    Transition CLOSED_LIMITED @{reasonCode='LIMITED_SCOPE_RESULT';administrativeReasonRef=(Id);deliveryDependencyId=$script:dependencyIds.DELIVERY}
    $before=Read-All;$oldEvents=ConvertTo-Json $before.events -Depth 20 -Compress;$oldStorage=ConvertTo-Json @((Read-Case).dependencies|Where-Object type -eq STORAGE)[0] -Compress
    Delivered;Dependency DELIVERY VERIFIED;$after=Read-All;$r=Read-Case
    Check ($r.state -eq 'CLOSED_LIMITED' -and $r.delivery.status -eq 'DELIVERED' -and @($r.dependencies|Where-Object { $_.type -eq 'DELIVERY' -and $_.status -eq 'VERIFIED' }).Count -eq 1) 'DELIVERY_FOLLOWUP_RESOLVED'
    Check ((ConvertTo-Json @($after.events|Select-Object -First $before.events.Count) -Depth 20 -Compress) -eq $oldEvents) 'OLD_HISTORY_PRESERVED'
    Check ((ConvertTo-Json @($r.dependencies|Where-Object type -eq STORAGE)[0] -Compress) -eq $oldStorage) 'UNRELATED_OBLIGATION_PRESERVED'
    Reject {Apply (Retire-Action)} 'OPEN_DEPENDENCIES'
}
Run-Case 'R2 envelope read and retirement reject already inconsistent closed obligations' {
    Ready;$script:next=Stamp 2;Dependency STORAGE OPEN;Result ACCOUNT UNVERIFIED $script:dependencyIds.STORAGE;Transition CHECKING;Delivered;Transition CLOSED_LIMITED @{reasonCode='LIMITED_SCOPE_RESULT'}
    $retireFile=New-PrivacyRegisterInput -Mode SYNTHETIC -StoreDirectory $script:root -InputObject (Retire-Action)
    & $module {param($p) $s=Read-Store $p 'SYNTHETIC';$d=@($s.requests[0].dependencies|Where-Object type -eq STORAGE)[0];$d.status='VERIFIED';$d.nextActionAt=$null;$d.evidenceRef=[guid]::NewGuid().ToString();Save-Store $p $s} $script:root
    $hash=Cipher-Hash;$inspection='stale'
    Reject {Get-PrivacyRegisterInspection -Mode SYNTHETIC -StoreDirectory $script:root -RegisterId $script:status.registerId -Query CASES -Result ([ref]$inspection)} 'ACTIVE_DEPENDENCY_REQUIRED'
    Check ($null -eq $inspection -and (Cipher-Hash) -eq $hash) 'INSPECTION_CLEARED_NO_REPAIR'
    Reject {Invoke-PrivacyRegister -Command apply -Mode SYNTHETIC -StoreDirectory $script:root -InputFile $retireFile} 'ACTIVE_DEPENDENCY_REQUIRED';Check ((Cipher-Hash) -eq $hash) 'CORRUPT_RETIRE_NO_MUTATION'
    Close-Unconfirmed FAILED
    & $module {param($p) $s=Read-Store $p 'SYNTHETIC';$d=@($s.requests[0].dependencies|Where-Object type -eq DELIVERY)[0];$d.nextActionAt=[DateTime]::UtcNow.AddDays(5).ToString('yyyy-MM-ddTHH:mm:ss.fffZ');Save-Store $p $s} $script:root
    Reject {Inspect CASES} 'DELIVERY_FOLLOWUP_REQUIRED'
}

Run-Case 'R2 fresh process discovers due and future cases and exact conflicting absent event outcomes without stdout data' {
    $future=Fixture;$due=$future.Clone();$due.requestId=Id;$due.eventId=Id;$due.correspondenceRef=Id;$due.subjectRef=Id;$due.scopeRef=Id;$due.expectedRevision=$script:status.revision;$due.nextActionAt=[DateTime]::UtcNow.AddSeconds(2).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    Apply $due;$exactFile=New-PrivacyRegisterInput -Mode SYNTHETIC -StoreDirectory $script:root -InputObject $due
    $conflict=$due.Clone();$conflict.evidenceRef=Id;$conflictFile=New-PrivacyRegisterInput -Mode SYNTHETIC -StoreDirectory $script:root -InputObject $conflict
    Start-Sleep -Seconds 3;$before=Read-All;$hash=Cipher-Hash;$inputCount=@([IO.Directory]::EnumerateFiles((Join-Path $script:root 'commands'))).Count
    $body=@'
$all=$null;$due=$null;$case=$null;$events=$null;$event=$null;$missing=$null
$pipeline=@(Get-PrivacyRegisterInspection -Mode SYNTHETIC -StoreDirectory $root -RegisterId $register -Query CASES -Result ([ref]$all))
ProbeCheck ($pipeline.Count -eq 0 -and $all.total -eq 2)
Get-PrivacyRegisterInspection -Mode SYNTHETIC -StoreDirectory $root -RegisterId $register -Query DUE -Result ([ref]$due)
ProbeCheck ($due.total -eq 1 -and $due.entries[0].dueReasons -contains 'NEXT_ACTION')
$id=$due.entries[0].requestId
Get-PrivacyRegisterInspection -Mode SYNTHETIC -StoreDirectory $root -RegisterId $register -Query CASE -RequestId $id -Result ([ref]$case)
ProbeCheck ($case.case.id -eq $id -and $case.case.state -eq 'RECEIVED' -and $case.case.scopeCodes.Count -eq 1 -and $case.case.delivery.status -eq 'NOT_ATTEMPTED')
Get-PrivacyRegisterInspection -Mode SYNTHETIC -StoreDirectory $root -RegisterId $register -Query EVENTS -RequestId $id -Result ([ref]$events)
ProbeCheck ($events.total -eq 1 -and $events.entries[0].operation -eq 'create')
Get-PrivacyRegisterInspection -Mode SYNTHETIC -StoreDirectory $root -RegisterId $register -Query EVENT -RequestId $id -EventId $events.entries[0].id -ExpectedInputFile '__EXACT__' -Result ([ref]$event)
ProbeCheck ($event.eventOutcome -eq 'RECORDED_EXACT')
Get-PrivacyRegisterInspection -Mode SYNTHETIC -StoreDirectory $root -RegisterId $register -Query EVENT -RequestId $id -EventId $events.entries[0].id -ExpectedInputFile '__CONFLICT__' -Result ([ref]$event)
ProbeCheck ($event.eventOutcome -eq 'RECORDED_CONFLICT')
Get-PrivacyRegisterInspection -Mode SYNTHETIC -StoreDirectory $root -RegisterId $register -Query CASE -RequestId ([guid]::NewGuid().ToString()) -Result ([ref]$missing)
ProbeCheck ($missing.status -eq 'NOT_FOUND' -and $null -eq $missing.case)
Get-PrivacyRegisterInspection -Mode SYNTHETIC -StoreDirectory $root -RegisterId $register -Query EVENT -RequestId $id -EventId ([guid]::NewGuid().ToString()) -Result ([ref]$missing)
ProbeCheck ($missing.eventOutcome -eq 'NOT_FOUND' -and $null -eq $missing.event)
'@
    Run-InspectionChild ($body.Replace('__EXACT__',$exactFile.Replace("'","''")).Replace('__CONFLICT__',$conflictFile.Replace("'","''")))
    Check-Unchanged $hash $before;Check (@([IO.Directory]::EnumerateFiles((Join-Path $script:root 'commands'))).Count -eq $inputCount) 'INSPECTION_INPUTS_UNCONSUMED'
    Apply $due;Check ($script:status.replayed -and $script:status.revision -eq $before.revision) 'INSPECTED_EXACT_REPLAY'
}
Run-Case 'R2 inspection is capped revision-bound detached and isolated across stores' {
    Ready;$hash=Cipher-Hash;$before=Read-All
    Reject {Inspect CASES @{Limit=101}} 'INSPECTION_LIMIT_INVALID';Reject {Inspect CASES @{Limit=0}} 'INSPECTION_LIMIT_INVALID';Reject {Inspect CASES @{Offset=10001}} 'INSPECTION_LIMIT_INVALID'
    $first=Inspect EVENTS @{RequestId=$script:requestId;Limit=1};Check ($first.entries.Count -eq 1 -and $first.nextOffset -eq 1) 'EVENTS_PAGE_CAP'
    Reject {Inspect EVENTS @{RequestId=$script:requestId;Offset=1;Limit=1}} 'SNAPSHOT_REVISION_REQUIRED'
    $second=Inspect EVENTS @{RequestId=$script:requestId;Offset=1;Limit=1;ExpectedRevision=$first.revision};Check ($second.entries.Count -eq 1 -and $second.entries[0].id -ne $first.entries[0].id) 'EVENTS_PAGE_PROGRESS'
    $detached=Inspect CASE @{RequestId=$script:requestId};$detached.case.state='CLOSED_COMPLETE';Check ((Read-Case).state -eq 'EXECUTING') 'DETACHED_CASE'
    Check-Unchanged $hash $before
    Result;Reject {Inspect EVENTS @{RequestId=$script:requestId;Offset=1;Limit=1;ExpectedRevision=$first.revision}} 'REVISION_CONFLICT'
    $oldRegister=$script:status.registerId;$oldRequest=$script:requestId;$oldRoot=$script:root
    [void](Fixture);$output=$null
    Reject {Get-PrivacyRegisterInspection -Mode SYNTHETIC -StoreDirectory $script:root -RegisterId $oldRegister -Query CASES -Result ([ref]$output)} 'REGISTER_BINDING_MISMATCH'
    $absent=Inspect CASE @{RequestId=$oldRequest};Check ($absent.status -eq 'NOT_FOUND') 'CROSS_STORE_CASE_ABSENT'
    Reject {Get-PrivacyRegisterInspection -Mode OPERATIONAL -StoreDirectory $oldRoot -RegisterId $oldRegister -Query CASES -Result ([ref]$output)} 'OPERATIONAL_PATH_FIXED'
    $missingRoot=Join-Path ([IO.Path]::GetTempPath()) ('SocialInsightPrivacyRegister-Synthetic-'+(Id));$caught=$false
    try{Get-PrivacyRegisterInspection -Mode SYNTHETIC -StoreDirectory $missingRoot -RegisterId (Id) -Query CASES -Result ([ref]$output)}catch{$caught=$true}
    Check ($caught -and -not (Test-Path -LiteralPath $missingRoot) -and $null -eq $output) 'MISSING_STORE_NOT_CREATED'
}
Run-Case 'R2 inspection applies lock tamper foreign ACL and actual reparse guards' {
    [void](Fixture);$lock=& $module {param($p) Lock-Store $p} $script:root
    try{Reject {Inspect CASES} 'STORE_BUSY'}finally{$lock.Dispose()}
    $path=Join-Path $script:root 'register.bin';$bytes=[IO.File]::ReadAllBytes($path);$bytes[-3]=$bytes[-3] -bxor 1;[IO.File]::WriteAllBytes($path,$bytes);$hash=Cipher-Hash
    Reject {Inspect CASES} 'CIPHERTEXT_REJECTED';Check ((Cipher-Hash) -eq $hash) 'TAMPER_NOT_REPAIRED'
    [void](Fixture);$path=Join-Path $script:root 'register.bin';$acl=[IO.FileSystemAclExtensions]::GetAccessControl([IO.FileInfo]::new($path),[Security.AccessControl.AccessControlSections]::Access);$original=[IO.FileSystemAclExtensions]::GetAccessControl([IO.FileInfo]::new($path),[Security.AccessControl.AccessControlSections]::Access)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),'Read','Allow'));[IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($path),$acl)
    try{Reject {Inspect CASES} 'FOREIGN_ACL'}finally{[IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($path),$original)}
    $protectedRoot=$script:root;$protectedStatus=$script:status;[void](Fixture);$target=Join-Path $script:root 'commands';$script:root=$protectedRoot;$script:status=$protectedStatus
    $commands=Join-Path $script:root 'commands';Check (@([IO.Directory]::EnumerateFileSystemEntries($commands)).Count -eq 0) 'EMPTY_OWNED_COMMAND_DIRECTORY'
    Remove-Item -LiteralPath $commands -Force
    try{New-Item -ItemType Junction -Path $commands -Target $target|Out-Null;Reject {Inspect CASES} 'REPARSE_PATH_REJECTED'}finally{Remove-Item -LiteralPath $commands -Force;& $module {param($p) New-PrivateDirectory $p} $commands}
}
Run-Case 'R2 original encrypted retirement replay conflicts and current-revision lookup is absent after restart' {
    Ready;Finish;$retire=Retire-Action;$file=New-PrivacyRegisterInput -Mode SYNTHETIC -StoreDirectory $script:root -InputObject $retire;$originalBytes=[IO.File]::ReadAllBytes($file)
    $script:status=Invoke-PrivacyRegister -Command apply -Mode SYNTHETIC -StoreDirectory $script:root -InputFile $file;$after=Read-All;$hash=Cipher-Hash
    $repeatPath=& $module {param($p,$b) $f=Join-Path (Join-Path $p 'commands') ([guid]::NewGuid().ToString()+'.bin');Create-PrivateFile $f $b;return $f} $script:root $originalBytes
    Check ([Convert]::ToHexString([IO.File]::ReadAllBytes($repeatPath)) -eq [Convert]::ToHexString($originalBytes)) 'EXACT_ORIGINAL_CIPHERTEXT_BYTES'
    Reject {Invoke-PrivacyRegister -Command apply -Mode SYNTHETIC -StoreDirectory $script:root -InputFile $repeatPath} 'REVISION_CONFLICT';Check-Unchanged $hash $after
    $lookup=$retire.Clone();$lookup.expectedRevision=$after.revision;Reject {Apply $lookup} 'REQUEST_NOT_FOUND';Check-Unchanged $hash $after
    $body=@'
$all=$null;$case=$null;$event=$null
Get-PrivacyRegisterInspection -Mode SYNTHETIC -StoreDirectory $root -RegisterId $register -Query CASES -Result ([ref]$all)
ProbeCheck ($all.total -eq 0 -and $all.entries.Count -eq 0)
Get-PrivacyRegisterInspection -Mode SYNTHETIC -StoreDirectory $root -RegisterId $register -Query CASE -RequestId '__REQUEST__' -Result ([ref]$case)
ProbeCheck ($case.status -eq 'NOT_FOUND' -and $null -eq $case.case)
Get-PrivacyRegisterInspection -Mode SYNTHETIC -StoreDirectory $root -RegisterId $register -Query EVENT -RequestId '__REQUEST__' -EventId '__EVENT__' -ExpectedInputFile '__INPUT__' -Result ([ref]$event)
ProbeCheck ($event.status -eq 'NOT_FOUND' -and $event.eventOutcome -eq 'NOT_FOUND' -and $null -eq $event.event)
'@
    Run-InspectionChild ($body.Replace('__REQUEST__',$script:requestId).Replace('__EVENT__',$retire.eventId).Replace('__INPUT__',$repeatPath.Replace("'","''")))
    Check-Unchanged $hash $after
}

Run-Case 'Unresolved encrypted replacement is preserved and blocks access' {
    [void](Fixture);$pending=Join-Path $script:root ('pending-'+(Id)+'.bin');& $module {param($p) Create-PrivateFile $p (Protect-Bytes ([Text.Encoding]::UTF8.GetBytes('{}')))} $pending
    Reject {Invoke-PrivacyRegister -Command status -Mode SYNTHETIC -StoreDirectory $script:root} 'UNRESOLVED_STORE_FILE';Check ([IO.File]::Exists($pending)) 'PENDING_PRESERVED'
}
} finally {
    foreach($owned in $roots){
        $resolved=[IO.Path]::GetFullPath($owned);$safeParent=[IO.Path]::GetTempPath().TrimEnd('\')
        if(-not [IO.Path]::GetDirectoryName($resolved).Equals($safeParent,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -cnotmatch '^SocialInsightPrivacyRegister-Synthetic-[0-9a-f-]{36}$'){throw 'UNSAFE_TEST_CLEANUP'}
        if(Test-Path -LiteralPath $resolved){$links=@(Get-ChildItem -LiteralPath $resolved -Force -Recurse|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint});if($links.Count -gt 0){throw 'REPARSE_TEST_CLEANUP_BLOCKED'};Remove-Item -LiteralPath $resolved -Recurse -Force}
    }
}
$runClock.Stop();$after=@();foreach($file in Get-ChildItem -LiteralPath $PSScriptRoot -File|Sort-Object Name){$after+=@{path=$file.Name;bytes=$file.Length;sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}}
$after|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'closure-privacy-register-r2-after.json')
$passed=@($results|Where-Object result -eq PASSED).Count;$failed=@($results|Where-Object result -eq FAILED).Count
$receipt=@{startedAt=$runStarted.ToString('o');completedAt=[DateTime]::UtcNow.ToString('o');runtime=$PSVersionTable.PSVersion.ToString();os=[Environment]::OSVersion.VersionString;mode='SYNTHETIC';currentUserDpapi=$true;operationalInitialized=$false;syntheticDirectories=$roots.Count;syntheticCleanupComplete=$true;sourceUnchanged=$false;summary=@{total=$results.Count;passed=$passed;failed=$failed;skipped=0;duration_ms=[int]$runClock.ElapsedMilliseconds};tests=@($results)}
$runtimeAfter=@($runtimePaths | ForEach-Object { @{file=[IO.Path]::GetFileName($_);sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()} });$receipt.runtimeBefore=$runtimeBefore;$receipt.runtimeAfter=$runtimeAfter;$receipt.runtimeUnchanged=((ConvertTo-Json $runtimeBefore -Compress) -eq (ConvertTo-Json $runtimeAfter -Compress));$receipt.operationalExistedBefore=$operationalExistedBefore;$receipt.operationalExistsAfter=(Test-Path -LiteralPath $operationalPath)
$receipt.sourceUnchanged=((ConvertTo-Json $before -Compress) -eq (ConvertTo-Json $after -Compress))
$receipt|ConvertTo-Json -Depth 15|Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'closure-privacy-register-r2-results.json')
[Console]::WriteLine("RESULT $passed passed; $failed failed; $($results.Count) total")
if($failed -gt 0 -or -not $receipt.sourceUnchanged -or -not $receipt.runtimeUnchanged -or $receipt.operationalExistedBefore -ne $receipt.operationalExistsAfter){exit 1}








