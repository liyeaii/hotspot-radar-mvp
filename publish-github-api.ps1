param(
  [string]$RepoName = "hotspot-radar-mvp",
  [ValidateSet("public", "private")]
  [string]$Visibility = "public",
  [string]$Owner = "",
  [string]$Branch = "main"
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

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)]
    [string]$File,
    [string[]]$CommandArgs = @()
  )

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $File @CommandArgs
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }

  if ($exitCode -ne 0) {
    throw "Command failed: $File $($CommandArgs -join ' ')"
  }

  return $output
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

function Invoke-GhJson {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [ValidateSet("POST", "PATCH")]
    [string]$Method,
    [Parameter(Mandatory = $true)]
    [hashtable]$Body
  )

  $json = $Body | ConvertTo-Json -Depth 60 -Compress
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = $json | gh api $Path --method $Method --input -
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }

  if ($exitCode -ne 0) {
    throw "GitHub API request failed: $Method $Path"
  }

  return ($output | ConvertFrom-Json)
}

function Get-GhJson {
  param([string]$Path)

  $result = Invoke-Quiet { gh api $Path }
  if ($result.ExitCode -ne 0) {
    return $null
  }

  return ($result.Output | ConvertFrom-Json)
}

Invoke-Native -File "gh" -CommandArgs @("auth", "status") | Out-Host

if (-not $Owner) {
  $Owner = ((Invoke-Native -File "gh" -CommandArgs @("api", "user", "--jq", ".login")) | Select-Object -First 1).Trim()
}

$target = "$Owner/$RepoName"
$visibilityFlag = "--$Visibility"

if (-not (Get-GhJson -Path "repos/$target")) {
  Invoke-Native -File "gh" -CommandArgs @("repo", "create", $target, $visibilityFlag) | Out-Host
}

$files = @(Invoke-Native -File "git" -CommandArgs @("ls-files"))
if (-not $files.Count) {
  throw "No tracked files found. Commit files before publishing."
}

Write-Host "Uploading $($files.Count) tracked files to https://github.com/$target via GitHub API..."

$treeItems = @()
$index = 0
foreach ($relativePath in $files) {
  $index += 1
  Write-Host "[$index/$($files.Count)] $relativePath"

  $localPath = Join-Path $PSScriptRoot ($relativePath -replace "/", [IO.Path]::DirectorySeparatorChar)
  $content = [Convert]::ToBase64String([IO.File]::ReadAllBytes($localPath))
  $blob = Invoke-GhJson -Path "repos/$target/git/blobs" -Method "POST" -Body @{
    content = $content
    encoding = "base64"
  }

  $treeItems += @{
    path = $relativePath
    mode = "100644"
    type = "blob"
    sha = $blob.sha
  }
}

$tree = Invoke-GhJson -Path "repos/$target/git/trees" -Method "POST" -Body @{
  tree = $treeItems
}

$head = Get-GhJson -Path "repos/$target/git/ref/heads/$Branch"
$parents = @()
if ($head -and $head.object -and $head.object.sha) {
  $parents = @($head.object.sha)
}

$localSha = ((Invoke-Native -File "git" -CommandArgs @("rev-parse", "--short", "HEAD")) | Select-Object -First 1).Trim()
$commitBody = @{
  message = "Publish hotspot radar MVP ($localSha)"
  tree = $tree.sha
}

if ($parents.Count) {
  $commitBody.parents = $parents
}

$commit = Invoke-GhJson -Path "repos/$target/git/commits" -Method "POST" -Body $commitBody

if ($parents.Count) {
  Invoke-GhJson -Path "repos/$target/git/refs/heads/$Branch" -Method "PATCH" -Body @{
    sha = $commit.sha
    force = $false
  } | Out-Null
} else {
  Invoke-GhJson -Path "repos/$target/git/refs" -Method "POST" -Body @{
    ref = "refs/heads/$Branch"
    sha = $commit.sha
  } | Out-Null
}

Invoke-GhJson -Path "repos/$target" -Method "PATCH" -Body @{
  default_branch = $Branch
} | Out-Null

Write-Host "Published: https://github.com/$target"
