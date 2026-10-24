<#
  Installs or updates TwoEasy from the latest GitHub release.
  Per-user install, no admin rights needed.

    irm https://raw.githubusercontent.com/andreagerali/TwoEasy/main/install.ps1 | iex

  Or download this file and run:  .\install.ps1 [-Silent]
#>
param([switch]$Silent)

$ErrorActionPreference = 'Stop'
$repo = 'andreagerali/TwoEasy'

$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'TwoEasy-installer' }
$asset = $release.assets | Where-Object { $_.name -like 'TwoEasy-Setup-*.exe' } | Select-Object -First 1
if (-not $asset) { throw "No installer found in the latest release ($($release.tag_name))." }

$installed = Join-Path $env:LOCALAPPDATA 'Programs\TwoEasy\TwoEasy.exe'
if (Test-Path $installed) {
    $have = (Get-Item $installed).VersionInfo.FileVersion
    if ("v$have" -eq $release.tag_name) { Write-Host "TwoEasy $have is already the latest version."; return }
    Write-Host "Updating TwoEasy $have -> $($release.tag_name)"
} else {
    Write-Host "Installing TwoEasy $($release.tag_name)"
}

$file = Join-Path $env:TEMP $asset.name
Invoke-WebRequest $asset.browser_download_url -OutFile $file -UseBasicParsing

# Check the download against the checksum GitHub publishes for the asset.
if ($asset.digest -like 'sha256:*') {
    $want = $asset.digest.Substring(7)
    $got = (Get-FileHash $file -Algorithm SHA256).Hash
    if ($got -ne $want) { Remove-Item $file; throw "Checksum mismatch: expected $want, got $got" }
}

Get-Process TwoEasy -ErrorAction SilentlyContinue | Stop-Process -Force
if ($Silent) { Start-Process $file -ArgumentList '/S' -Wait } else { Start-Process $file -Wait }
Remove-Item $file -ErrorAction SilentlyContinue
Write-Host 'Done.'
