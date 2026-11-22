# Builds dist\Winampify-<version>.msi from release\Winampify (run "node build.js" first).
# Needs WiX 3 in tools\wix3 (portable, no install).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$wix = Join-Path $root 'tools\wix3'
$src = Join-Path $root 'release\Winampify'
$obj = Join-Path $root 'installer\obj'
$out = Join-Path $root 'dist'
if (-not (Test-Path (Join-Path $src 'Winampify.exe'))) { throw "Build the app first: node build.js" }
New-Item -ItemType Directory -Force $obj, $out | Out-Null

# version: package.json major.minor + a build number that grows every day (MSI needs it for upgrades)
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$mm = ($pkg.version -split '\.')[0..1] -join '.'
$build = [int]((Get-Date) - (Get-Date '2026-01-01')).TotalDays
$version = "$mm.$build"

# 1) list every file of the app
& (Join-Path $wix 'heat.exe') dir $src -nologo -cg AppFiles -dr INSTALLFOLDER -srd -gg -sfrag -sreg -var var.SourceDir -out (Join-Path $obj 'files.wxs')
if ($LASTEXITCODE) { throw "heat failed" }
# per-user install: mark the harvested components as 64-bit
(Get-Content (Join-Path $obj 'files.wxs') -Raw) -replace '<Component ', '<Component Win64="yes" ' | Set-Content (Join-Path $obj 'files.wxs') -Encoding UTF8

# 2) compile
& (Join-Path $wix 'candle.exe') -nologo -arch x64 -ext WixUIExtension -ext WixUtilExtension `
  "-dSourceDir=$src" "-dVersion=$version" "-dIconFile=$(Join-Path $root 'icons\winampify.ico')" "-dLicenseFile=$(Join-Path $root 'installer\License.rtf')" `
  -out "$obj\" (Join-Path $root 'installer\Winampify.wxs') (Join-Path $obj 'files.wxs')
if ($LASTEXITCODE) { throw "candle failed" }

# 3) link into the .msi (ICE validation skipped: it doesn't understand per-user file components)
$msi = Join-Path $out "Winampify-$version.msi"
& (Join-Path $wix 'light.exe') -nologo -sval -ext WixUIExtension -ext WixUtilExtension -spdb -out $msi (Join-Path $obj 'Winampify.wixobj') (Join-Path $obj 'files.wixobj')
if ($LASTEXITCODE) { throw "light failed" }
"Built $msi ({0:N0} MB)" -f ((Get-Item $msi).Length / 1MB)
