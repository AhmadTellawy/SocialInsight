#requires -Version 7.5
[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('init','apply','status')][string]$Command,[Parameter(Mandatory)][ValidateSet('SYNTHETIC','OPERATIONAL')][string]$Mode,[string]$StoreDirectory,[string]$InputFile)
$ErrorActionPreference='Stop'
try {
    Import-Module (Join-Path $PSScriptRoot 'Register.psm1') -Force -ErrorAction Stop
    $result=Invoke-PrivacyRegister @PSBoundParameters
    ConvertTo-Json -InputObject $result -Depth 5 -Compress
} catch {
    $code=if ($_.Exception.Message -cmatch '^[A-Z_]{3,64}$') { $_.Exception.Message } else { 'INPUT_OR_STORAGE_REJECTED' }
    [Console]::Error.WriteLine($code)
    exit 1
}

