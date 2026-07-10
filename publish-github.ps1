param(
  [string]$RepoName = "hotspot-radar-mvp",
  [ValidateSet("public", "private")]
  [string]$Visibility = "public",
  [string]$Owner = ""
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Run($File, [string[]]$Args) {
  & $File @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $File $($Args -join ' ')"
  }
}

Run "node" @("--test")
Run "gh" @("auth", "status")

if (-not $Owner) {
  $Owner = (gh api user --jq .login).Trim()
}

$target = "$Owner/$RepoName"
$visibilityFlag = "--$Visibility"

$origin = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0 -or -not $origin) {
  gh repo view $target *> $null
  if ($LASTEXITCODE -eq 0) {
    Run "git" @("remote", "add", "origin", "https://github.com/$target.git")
  } else {
    Run "gh" @("repo", "create", $target, $visibilityFlag, "--source", ".", "--remote", "origin")
  }
}

Run "git" @("branch", "-M", "main")
Run "git" @("push", "-u", "origin", "main")

Write-Host "Published: https://github.com/$target"
