param([Parameter(Mandatory=$true)][string]$Helper,[Parameter(Mandatory=$true)][string]$Pipe)
$ErrorActionPreference = 'Stop'
try {
  Start-Process -FilePath $Helper -ArgumentList @('--pipe', $Pipe) -Verb RunAs -WindowStyle Hidden | Out-Null
} catch { exit 1 }
