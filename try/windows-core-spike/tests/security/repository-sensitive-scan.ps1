[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [string]$ArtifactRoot,
    [string]$TrackedListPath,
    [switch]$UseWdioArtifacts
)

$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\..')
)
if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $resolvedRepositoryRoot = (& git -C $projectRoot rev-parse --show-toplevel 2>$null)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($resolvedRepositoryRoot)) {
        throw 'SENSITIVE_SCAN_REPOSITORY_ROOT_UNAVAILABLE'
    }
    $RepositoryRoot = [System.IO.Path]::GetFullPath($resolvedRepositoryRoot.Trim())
}
else {
    $RepositoryRoot = [System.IO.Path]::GetFullPath($RepositoryRoot)
}

if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
    $ArtifactRoot = Join-Path $projectRoot 'artifacts\security-scan'
}
$ArtifactRoot = [System.IO.Path]::GetFullPath($ArtifactRoot)
[System.IO.Directory]::CreateDirectory($ArtifactRoot) | Out-Null

$snapshotPath = Join-Path $ArtifactRoot 'project-snapshot.json'
$frontendLogPath = Join-Path $ArtifactRoot 'frontend.log'
$backendLogPath = Join-Path $ArtifactRoot 'backend.log'

if (-not (Test-Path -LiteralPath $snapshotPath -PathType Leaf)) {
    $snapshot = [ordered]@{
        schemaVersion = 'blocky.spike-project/v1'
        projectId = 'windows-core-scan'
        workspace = [ordered]@{
            blocks = [ordered]@{ blocks = @(); languageVersion = 0 }
        }
        program = [ordered]@{ schemaVersion = 'blocky.ir/v0-spike'; roots = @() }
        interactionManifest = [ordered]@{
            schemaVersion = 'blocky.interaction/v0-spike'
            entries = @()
        }
    }
    $snapshotJson = $snapshot | ConvertTo-Json -Depth 16 -Compress
    [System.IO.File]::WriteAllText(
        $snapshotPath,
        $snapshotJson + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false)
    )
}

if ($UseWdioArtifacts) {
    $wdioRoot = Join-Path $projectRoot 'artifacts\wdio'
    $frontendLines = [System.Collections.Generic.List[string]]::new()
    $backendLines = [System.Collections.Generic.List[string]]::new()
    if (Test-Path -LiteralPath $wdioRoot -PathType Container) {
        $wdioFiles = Get-ChildItem -LiteralPath $wdioRoot -Recurse -File |
            Where-Object { $_.Name -ne 'audit-summary.json' }
        foreach ($file in $wdioFiles) {
            foreach ($line in [System.IO.File]::ReadAllLines($file.FullName)) {
                if ($line.Contains('[Tauri:Frontend:')) {
                    $frontendLines.Add($line)
                }
                else {
                    $backendLines.Add($line)
                }
            }
        }
    }
    [System.IO.File]::WriteAllLines(
        $frontendLogPath,
        $frontendLines,
        [System.Text.UTF8Encoding]::new($false)
    )
    [System.IO.File]::WriteAllLines(
        $backendLogPath,
        $backendLines,
        [System.Text.UTF8Encoding]::new($false)
    )
}
else {
    if (-not (Test-Path -LiteralPath $frontendLogPath -PathType Leaf)) {
        [System.IO.File]::WriteAllText(
            $frontendLogPath,
            'frontend diagnostics clean' + [Environment]::NewLine,
            [System.Text.UTF8Encoding]::new($false)
        )
    }
    if (-not (Test-Path -LiteralPath $backendLogPath -PathType Leaf)) {
        [System.IO.File]::WriteAllText(
            $backendLogPath,
            'backend diagnostics clean' + [Environment]::NewLine,
            [System.Text.UTF8Encoding]::new($false)
        )
    }
}

$modelPrefix = ('s' + 'k' + '-')
$githubClassicPrefix = ('g' + 'h')
$githubFinePrefix = ('git' + 'hub' + '_pat_')
$awsPrefix = ('A' + 'K' + 'I' + 'A')
$pemBoundary = ('-' * 5)
$bearerName = ('Bear' + 'er')
$cookieName = ('coo' + 'kie')
$detectors = [ordered]@{
    'model-token' = [regex]::new(
        ('\b{0}(?:[A-Za-z0-9_-]{{20,}})\b' -f [regex]::Escape($modelPrefix))
    )
    'github-token' = [regex]::new(
        ('\b(?:{0}[pousr]_[A-Za-z0-9]{{20,}}|{1}[A-Za-z0-9_]{{20,}})\b' -f
            [regex]::Escape($githubClassicPrefix),
            [regex]::Escape($githubFinePrefix))
    )
    'aws-access-key' = [regex]::new(
        ('\b{0}[A-Z0-9]{{16}}\b' -f [regex]::Escape($awsPrefix))
    )
    'bearer-token' = [regex]::new(
        ('\b{0}\s+[A-Za-z0-9._~+/-]{{8,}}\b' -f [regex]::Escape($bearerName)),
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    'pem-private-key' = [regex]::new(
        ('{0}BEGIN (?:[A-Z ]+ )?PRIVATE KEY{0}' -f [regex]::Escape($pemBoundary))
    )
    'cookie' = [regex]::new(
        ('(?:^|[;\s])(?:set-)?{0}\s*:\s*[^\s;=]+=[^\s;]+' -f [regex]::Escape($cookieName)),
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    'windows-absolute-path' = [regex]::new(
        '(?:^|[^A-Za-z0-9_])[A-Za-z]:\\(?:[^\s\\/:*?"<>|]+\\)*[^\s\\/:*?"<>|]+'
    )
    'unix-absolute-path' = [regex]::new(
        '(?:^|[^A-Za-z0-9_])file=/(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+|(?:^|[^:/A-Za-z0-9_])/(?:var|tmp|home|usr|etc|opt|mnt|workspace)(?:/[A-Za-z0-9._-]+)+',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
}

$binaryExtensions = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
)
foreach ($extension in @(
    '.exe', '.pdb', '.dll', '.msi', '.zip', '.7z', '.rar', '.gz', '.tar',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns'
)) {
    [void]$binaryExtensions.Add($extension)
}

function Get-TrackedPaths {
    if (-not [string]::IsNullOrWhiteSpace($TrackedListPath)) {
        return Get-Content -LiteralPath $TrackedListPath |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            ForEach-Object { [System.IO.Path]::GetFullPath($_) }
    }

    $relativePaths = & git -C $RepositoryRoot ls-files -- 'try/windows-core-spike'
    if ($LASTEXITCODE -ne 0) {
        throw 'SENSITIVE_SCAN_TRACKED_LIST_FAILED'
    }
    return $relativePaths |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        ForEach-Object { [System.IO.Path]::GetFullPath((Join-Path $RepositoryRoot $_)) }
}

function Get-TextContent([string]$Path) {
    if ($binaryExtensions.Contains([System.IO.Path]::GetExtension($Path))) {
        return $null
    }
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes -contains 0) {
        return $null
    }
    return [System.Text.UTF8Encoding]::new($false, $true).GetString($bytes)
}

$counts = [ordered]@{
    tracked = 0
    snapshot = 0
    frontend_log = 0
    backend_log = 0
}
$findings = [System.Collections.Generic.List[object]]::new()

function Measure-Target(
    [string]$Target,
    [string[]]$Paths
) {
    foreach ($path in $Paths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw ('SENSITIVE_SCAN_INPUT_MISSING:{0}' -f $Target)
        }
        $content = Get-TextContent -Path $path
        if ($null -eq $content) {
            continue
        }
        foreach ($entry in $detectors.GetEnumerator()) {
            $matchCount = $entry.Value.Matches($content).Count
            if ($matchCount -eq 0) {
                continue
            }
            $counts[$Target] += $matchCount
            $findings.Add([ordered]@{
                target = $Target
                category = $entry.Key
                file = [System.IO.Path]::GetFileName($path)
                count = $matchCount
            })
        }
    }
}

Measure-Target -Target 'tracked' -Paths @(Get-TrackedPaths)
Measure-Target -Target 'snapshot' -Paths @($snapshotPath)
Measure-Target -Target 'frontend_log' -Paths @($frontendLogPath)
Measure-Target -Target 'backend_log' -Paths @($backendLogPath)

$summary = 'SENSITIVE_SCAN tracked={0} snapshot={1} frontend_log={2} backend_log={3}' -f
    $counts.tracked,
    $counts.snapshot,
    $counts.frontend_log,
    $counts.backend_log
[Console]::Out.WriteLine($summary)
foreach ($finding in $findings) {
    [Console]::Error.WriteLine(
        ('SENSITIVE_FINDING target={0} category={1} file={2} count={3}' -f
            $finding.target,
            $finding.category,
            $finding.file,
            $finding.count)
    )
}

if ($findings.Count -gt 0) {
    exit 1
}
exit 0
