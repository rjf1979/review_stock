<#
Run the 25-pattern backtest in parallel shards (local data/hsjday + qfq factors only, no network).

Example:
  powershell -File tools/run_backtest_parts.ps1 -ExitMode pattern -OutDir parts2

Output: data/backtest/xingtaidu/<OutDir>/part_i.csv|json|log|err
Merge:  python tools/xingtaidu_backtest_merge.py --glob "data/backtest/xingtaidu/<OutDir>/part_*.csv" --out <name>

NOTE: this file must stay ASCII-only. Windows PowerShell 5.1 reads BOM-less .ps1
as ANSI, so non-ASCII literals would be mis-decoded and can break parsing.
#>
param(
    [int]$Parts = 6,
    [string]$StartDate = '2021-01-01',
    [string]$EndDate = '2026-09-18',
    [ValidateSet('pattern', 'uniform')][string]$ExitMode = 'pattern',
    [string]$Patterns = 'all',
    [string]$Config = '',
    [string]$OutDir = 'parts2',
    [string]$SplitDir = 'parts'
)

$ErrorActionPreference = 'Stop'
$env:PYTHONIOENCODING = 'utf-8'

$repo = Split-Path -Parent $PSScriptRoot
$base = Join-Path $repo 'data\backtest\xingtaidu'
$split = Join-Path $base $SplitDir
$dest = Join-Path $base $OutDir
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$script = Join-Path $repo 'tools\xingtaidu_backtest.py'

$procs = @()
for ($i = 0; $i -lt $Parts; $i++) {
    $codesFile = Join-Path $split "codes_$i.txt"
    if (-not (Test-Path -LiteralPath $codesFile)) { throw "missing shard file: $codesFile" }
    $codes = (Get-Content -LiteralPath $codesFile -Raw).Trim()
    if (-not $codes) { throw "empty shard file: $codesFile" }
    $outPrefix = "$OutDir/part_$i"
    $args = @(
        $script,
        '--codes', $codes,
        '--start', $StartDate,
        '--end', $EndDate,
        '--patterns', $Patterns,
        '--exit-mode', $ExitMode,
        '--out', $outPrefix
    )
    if ($Config) {
        $cfgPath = Join-Path $repo $Config
        if (-not (Test-Path -LiteralPath $cfgPath)) { throw "missing config file: $cfgPath" }
        $args += @('--config', $cfgPath)
    }
    $procs += Start-Process -FilePath 'python' -ArgumentList $args `
        -WorkingDirectory $repo -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $dest "part_$i.log") `
        -RedirectStandardError (Join-Path $dest "part_$i.err")
}

Write-Output ("started {0} shard processes: {1}" -f $Parts, (($procs | ForEach-Object { $_.Id }) -join ', '))
foreach ($p in $procs) { $p.WaitForExit() }

$failed = @()
foreach ($p in $procs) {
    # -PassThru objects can report $null ExitCode after WaitForExit; treat that as OK
    # only when the shard actually produced its json artifact.
    $code = $p.ExitCode
    $json = Join-Path $dest ("part_" + [array]::IndexOf($procs, $p) + ".json")
    if ($null -ne $code -and $code -ne 0) { $failed += $p.Id; continue }
    if (-not (Test-Path -LiteralPath $json)) { $failed += $p.Id }
}
if ($failed.Count -gt 0) {
    Write-Output ("failed shards: {0}; check *.err under {1}" -f ($failed -join ', '), $dest)
    exit 1
}
Write-Output "all shards finished, output dir: $dest"
