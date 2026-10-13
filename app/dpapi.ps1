# DPAPI helper: read one file, write another.
#
# KEEP THIS FILE PURE ASCII. Windows PowerShell 5.1 reads .ps1 as ANSI unless it
# carries a BOM; any non-ASCII byte turns into a parse error at line 1.
#
# Why files instead of command-line args: argv is visible in the process list.
#
# Why ConvertFrom-SecureString / ConvertTo-SecureString instead of
# [System.Security.Cryptography.ProtectedData]: that type lives in System.Security.dll,
# which PowerShell 5.1 does not load by default, and loading it needs Add-Type or
# [Reflection.Assembly]::Load -- both blocked under hardened execution policies.
# These two cmdlets use DPAPI with the CurrentUser scope underneath, no extra assembly.
param(
  [Parameter(Mandatory = $true)][string]$Mode,
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Text-FromSecureString([System.Security.SecureString]$Secure) {
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

try {
  if ($Mode -eq 'protect') {
    $plain = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($In))
    if ($plain.Length -eq 0) { exit 3 }
    $secure = ConvertTo-SecureString -String $plain -AsPlainText -Force
    $blob = ConvertFrom-SecureString -SecureString $secure
    [System.IO.File]::WriteAllText($Out, $blob)
    exit 0
  }
  if ($Mode -eq 'unprotect') {
    $blob = ([System.IO.File]::ReadAllText($In)).Trim()
    $secure = ConvertTo-SecureString -String $blob
    $plain = Text-FromSecureString $secure
    [System.IO.File]::WriteAllBytes($Out, [System.Text.Encoding]::UTF8.GetBytes($plain))
    exit 0
  }
  exit 2
}
catch {
  exit 1
}
