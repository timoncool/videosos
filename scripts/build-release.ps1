[CmdletBinding()]
param(
    # Free-text release notes for latest.json (shown by the updater).
    [string]$ReleaseNotes = "",
    # Check the inputs (version, key, bundled files, tools) and print the plan; build nothing.
    [switch]$DryRun,
    # Run the test gate, build the frontend and stage the bundle, then stop before `tauri build`.
    [switch]$StopAfterStaging
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$desktopRoot = Join-Path $repoRoot 'desktop'
$tauriRoot = Join-Path $desktopRoot 'src-tauri'
$frontendRoot = Join-Path $repoRoot 'frontend'
$stagingRoot = Join-Path $tauriRoot 'staging'
$bundleConfigPath = Join-Path $tauriRoot 'tauri.bundle.conf.json'

$whereTheKeyIs = @'
The updater signing key is read from the environment:
  TAURI_SIGNING_PRIVATE_KEY           the key itself (or its path)
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD  its password
When they are not set, %USERPROFILE%\.tauri\videosos-updater.key and, beside it,
videosos-updater.key.password are used; VIDEOSOS_KEY_FILE overrides that path.
The public half must match plugins.updater.pubkey in desktop/src-tauri/tauri.conf.json,
or every update is rejected. The key and its password never go into the repository.
'@

function Fail([string]$message) { throw $message }

function Invoke-Step([string]$name, [scriptblock]$command) {
    Write-Host "[STEP] $name"
    # Native tools write progress to stderr; under Stop that would abort a healthy build.
    # The exit code is the verdict.
    $ErrorActionPreference = 'Continue'
    & $command
    if ($LASTEXITCODE -ne 0) { Fail "$name failed with exit code $LASTEXITCODE" }
}

function Copy-Required([string]$from, [string]$to) {
    if (-not (Test-Path -LiteralPath $from)) { Fail "bundled file is missing: $from" }
    Copy-Item -LiteralPath $from -Destination $to -Force
}

$tauriConf = Get-Content -Raw -Encoding UTF8 (Join-Path $tauriRoot 'tauri.conf.json') | ConvertFrom-Json
$Version = $tauriConf.version
if ($Version -notmatch '^\d+\.\d+\.\d+([\-+][0-9A-Za-z.-]+)?$') { Fail "version in tauri.conf.json is not semver: '$Version'" }
$cargoToml = Get-Content -Raw -Encoding UTF8 (Join-Path $tauriRoot 'Cargo.toml')
if ($cargoToml -notmatch '(?m)^version\s*=\s*"([^"]+)"') { Fail 'desktop/src-tauri/Cargo.toml has no package version' }
if ($Matches[1] -ne $Version) { Fail "desktop/src-tauri/Cargo.toml says $($Matches[1]) but tauri.conf.json says $Version; bump both" }
$binaryName = $tauriConf.mainBinaryName
if ([string]::IsNullOrWhiteSpace($binaryName)) { Fail 'mainBinaryName is missing in tauri.conf.json' }
$pubkey = $tauriConf.plugins.updater.pubkey
$endpoint = @($tauriConf.plugins.updater.endpoints)[0]
if ($endpoint -notmatch '/releases/latest/download/latest\.json$') { Fail "unexpected updater endpoint: $endpoint" }
$downloadBase = $endpoint -replace '/latest/download/latest\.json$', "/download/v$Version"

if (-not (Test-Path $bundleConfigPath)) { Fail "missing $bundleConfigPath" }

$releaseDir = Join-Path $repoRoot "release\$Version"
$targetRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $tauriRoot 'target' }
$bundleRoot = Join-Path $targetRoot 'release\bundle'

# Key: environment first, then the key file beside the user's Tauri settings.
$keyFile = if ($env:VIDEOSOS_KEY_FILE) { $env:VIDEOSOS_KEY_FILE } else { Join-Path $env:USERPROFILE '.tauri\videosos-updater.key' }
if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY) -and (Test-Path $keyFile)) {
    $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -Raw $keyFile).Trim()
}
if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) -and (Test-Path "$keyFile.password")) {
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content -Raw "$keyFile.password").Trim()
}
if (Test-Path "$keyFile.pub") {
    if ((Get-Content -Raw "$keyFile.pub").Trim() -ne $pubkey) {
        Fail "$keyFile.pub does not match plugins.updater.pubkey in tauri.conf.json: updates signed with this key would be rejected."
    }
}
$keyProblem = $null
if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) {
    $keyProblem = 'TAURI_SIGNING_PRIVATE_KEY is empty.'
}
else {
    # Without a password an encrypted key does not fail, it hangs: Tauri asks on stdin and the
    # build sits in silence after the installers are already on disk.
    $decodedKey = try { [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TAURI_SIGNING_PRIVATE_KEY)) } catch { $env:TAURI_SIGNING_PRIVATE_KEY }
    if ($decodedKey -match 'encrypted secret key' -and [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)) {
        $keyProblem = 'the signing key is encrypted and TAURI_SIGNING_PRIVATE_KEY_PASSWORD is empty.'
    }
}

Write-Host "[INFO] version $Version, binary $binaryName.exe, release dir $releaseDir"
if ($keyProblem) {
    if ($DryRun) { Write-Host "[WARN] $keyProblem`n$whereTheKeyIs" }
    else { Fail "$keyProblem`n`n$whereTheKeyIs" }
}
else {
    Write-Host '[OK] signing key is available'
}

$frontendScripts = (Get-Content -Raw -Encoding UTF8 (Join-Path $frontendRoot 'package.json') | ConvertFrom-Json).scripts
$frontendHasTests = $null -ne $frontendScripts.PSObject.Properties['test:run']

if ($DryRun) {
    Write-Host ('[PLAN] frontend: npm ci (if node_modules is missing)' + $(if ($frontendHasTests) { ', npm run test:run' } else { ' (no test script)' }) + ', npm run build')
    Write-Host '[PLAN] cargo test --workspace'
    Write-Host '[PLAN] cargo test --manifest-path desktop/src-tauri/Cargo.toml'
    Write-Host "[PLAN] stage into $stagingRoot"
    Write-Host "[PLAN] tauri build --config $bundleConfigPath (NSIS + MSI, signed)"
    Write-Host "[PLAN] release\${Version}: setup.exe (+.sig), msi (+.sig), portable zip, latest.json"
    Write-Host '[OK] dry run finished, nothing was built'
    return
}

foreach ($name in $binaryName, 'videosos-desktop') {
    $running = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($targetRoot, [StringComparison]::OrdinalIgnoreCase) }
    if ($running) { Fail "$name.exe is running from $targetRoot and would keep the linker from replacing it; close it first." }
}

Push-Location $repoRoot
try {
    # The frontend comes first: the desktop shell embeds frontend/dist at compile time (tauri-codegen
    # refuses to build without it), and dist is not in git.
    if (-not (Test-Path (Join-Path $frontendRoot 'node_modules'))) {
        Invoke-Step 'frontend npm ci' { npm --prefix $frontendRoot ci }
    }
    if ($frontendHasTests) {
        Invoke-Step 'frontend tests' { npm --prefix $frontendRoot run test:run }
    }
    Invoke-Step 'frontend build' { npm --prefix $frontendRoot run build }
    Invoke-Step 'cargo test --workspace' { cargo test --workspace }
    Invoke-Step 'cargo test (desktop shell)' { cargo test --manifest-path (Join-Path $tauriRoot 'Cargo.toml') }

    if (Test-Path $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
    # The server is compiled into the desktop executable: only the window goes into the bundle.
    Copy-Item -LiteralPath (Join-Path $frontendRoot 'dist') -Destination (Join-Path $stagingRoot 'frontend\dist') -Recurse
    if (-not (Test-Path (Join-Path $stagingRoot 'frontend\dist\index.html'))) { Fail 'the staged window has no index.html' }
    Write-Host "[OK] bundle staged in $stagingRoot"

    if ($StopAfterStaging) {
        Write-Host '[OK] stopped after staging'
        return
    }

    if (-not (Test-Path (Join-Path $desktopRoot 'node_modules'))) {
        Invoke-Step 'desktop npm ci' { npm --prefix $desktopRoot ci }
    }
    Push-Location $desktopRoot
    try {
        Invoke-Step 'tauri build' { npm exec tauri build -- --config $bundleConfigPath }
    }
    finally {
        Pop-Location
    }

    if (Test-Path $releaseDir) { Get-ChildItem -LiteralPath $releaseDir -File | Remove-Item -Force }
    New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

    # Exact version in the filter: a bundle folder keeps installers of earlier builds.
    $nsisInstaller = Get-ChildItem -Recurse -File (Join-Path $bundleRoot 'nsis') -Filter "*_$($Version)_x64-setup.exe" | Select-Object -First 1
    if (-not $nsisInstaller) { Fail "the NSIS installer for $Version is missing in $bundleRoot" }
    $msiInstaller = Get-ChildItem -Recurse -File (Join-Path $bundleRoot 'msi') -Filter "*_$($Version)_x64_*.msi" | Select-Object -First 1
    if (-not $msiInstaller) { Fail "the MSI for $Version is missing in $bundleRoot" }

    # GitHub replaces spaces in asset names with dots; the manifest must name the asset as it is served.
    $assets = @{}
    foreach ($installer in $nsisInstaller, $msiInstaller) {
        $signaturePath = "$($installer.FullName).sig"
        if (-not (Test-Path $signaturePath)) { Fail "the updater signature is missing: $signaturePath" }
        $assetName = $installer.Name -replace ' ', '.'
        Copy-Item $installer.FullName (Join-Path $releaseDir $assetName) -Force
        Copy-Item $signaturePath (Join-Path $releaseDir "$assetName.sig") -Force
        $assets[$installer.Extension] = @{ name = $assetName; signature = (Get-Content -Raw $signaturePath).Trim() }
    }

    # Portable: the executable, the bundle beside it, and the marker that makes the copy portable.
    $builtExe = Join-Path $targetRoot "release\$binaryName.exe"
    if (-not (Test-Path $builtExe)) { Fail "the built executable is missing: $builtExe" }
    $portableRoot = Join-Path $releaseDir "VideoSOS-$Version-portable"
    if (Test-Path $portableRoot) { Remove-Item -LiteralPath $portableRoot -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $portableRoot | Out-Null
    Copy-Item $builtExe (Join-Path $portableRoot "$binaryName.exe") -Force
    Get-ChildItem -LiteralPath $stagingRoot | Copy-Item -Destination $portableRoot -Recurse -Force
    New-Item -ItemType File -Path (Join-Path $portableRoot 'portable.flag') -Force | Out-Null
    $portableZip = Join-Path $releaseDir "VideoSOS-$Version-portable-windows-x64.zip"
    if (Test-Path $portableZip) { Remove-Item -Force $portableZip }
    # Windows PowerShell 5.1 (Compress-Archive and ZipFile.CreateFromDirectory) writes backslashes
    # into entry names; other unzip tools then extract flat files named "frontend\x.js".
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::Open($portableZip, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $prefixLength = (Resolve-Path -LiteralPath $portableRoot).Path.TrimEnd('\').Length + 1
        Get-ChildItem -LiteralPath $portableRoot -Recurse -File | ForEach-Object {
            $entryName = $_.FullName.Substring($prefixLength).Replace('\', '/')
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal)
        }
    }
    finally {
        $zip.Dispose()
    }
    Remove-Item -LiteralPath $portableRoot -Recurse -Force

    $latest = [ordered]@{
        version = $Version
        notes = $ReleaseNotes
        pub_date = (Get-Date).ToUniversalTime().ToString('o')
        platforms = [ordered]@{
            'windows-x86_64' = [ordered]@{
                signature = $assets['.exe'].signature
                url = "$downloadBase/$($assets['.exe'].name)"
            }
            'windows-x86_64-nsis' = [ordered]@{
                signature = $assets['.exe'].signature
                url = "$downloadBase/$($assets['.exe'].name)"
            }
            'windows-x86_64-msi' = [ordered]@{
                signature = $assets['.msi'].signature
                url = "$downloadBase/$($assets['.msi'].name)"
            }
        }
    }
    # A byte-order mark in front of the JSON makes the updater reject it.
    [System.IO.File]::WriteAllText(
        (Join-Path $releaseDir 'latest.json'),
        ($latest | ConvertTo-Json -Depth 8),
        (New-Object System.Text.UTF8Encoding($false))
    )
    Get-ChildItem $releaseDir -File | Select-Object Name, Length | Format-Table | Out-Host
    Write-Host "[OK] release $Version is in $releaseDir; upload the files to GitHub release v$Version (not a pre-release)"
}
finally {
    Pop-Location
}
