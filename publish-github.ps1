param(
  [string]$RepoName = "hotspot-radar-mvp",
  [ValidateSet("public", "private")]
  [string]$Visibility = "public",
  [string]$Owner = ""
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$RepoPath = (Resolve-Path $PSScriptRoot).Path.Replace("\", "/")

$safeDirectories = @(git config --global --get-all safe.directory 2>$null)
if ($safeDirectories -notcontains $RepoPath) {
  git config --global --add safe.directory $RepoPath
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to mark repository as safe.directory: $RepoPath"
  }
}

function Run {
  param(
    [Parameter(Mandatory = $true)]
    [string]$File,
    [string[]]$CommandArgs = @()
  )

  & $File @CommandArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $File $($CommandArgs -join ' ')"
  }
}

function Invoke-Quiet {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command
  )

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $Command 2>$null
    return [pscustomobject]@{
      ExitCode = $LASTEXITCODE
      Output = $output
    }
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

function Get-OriginRemote {
  $result = Invoke-Quiet { git remote get-url origin }
  if ($result.ExitCode -eq 0) {
    return (($result.Output | Select-Object -First 1) -as [string])
  }
  return ""
}

function Test-GitHubRepo {
  param([string]$NameWithOwner)

  $result = Invoke-Quiet { gh repo view $NameWithOwner }
  return $result.ExitCode -eq 0
}

Run -File "node" -CommandArgs @("--test")
Run -File "gh" -CommandArgs @("auth", "status")

if (-not $Owner) {
  $Owner = (gh api user --jq .login).Trim()
}

$target = "$Owner/$RepoName"
$visibilityFlag = "--$Visibility"

$origin = Get-OriginRemote
if (-not $origin) {
  if (Test-GitHubRepo -NameWithOwner $target) {
    Run -File "git" -CommandArgs @("remote", "add", "origin", "https://github.com/$target.git")
  } else {
    Run -File "gh" -CommandArgs @("repo", "create", $target, $visibilityFlag, "--source", ".", "--remote", "origin")
  }
}

Run -File "git" -CommandArgs @("branch", "-M", "main")
Run -File "git" -CommandArgs @("push", "-u", "origin", "main")

Write-Host "Published: https://github.com/$target"
