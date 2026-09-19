# 注册 Windows 计划任务：每交易日收盘后自动增量更新日 K
# 用法（管理员 PowerShell）：
#   powershell -ExecutionPolicy Bypass -File tools\register_task.ps1
#   powershell -ExecutionPolicy Bypass -File tools\register_task.ps1 -Time 19:00 -Source sohu
# 卸载：
#   Unregister-ScheduledTask -TaskName "KlineFullDaily" -Confirm:$false

param(
    [string]$Time = '18:30',
    [string]$Source = 'tdx',
    [string]$TaskName = 'KlineFullDaily'
)

$ErrorActionPreference = 'Stop'
$ToolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ToolsDir
$Bat = Join-Path $ToolsDir 'run_daily.bat'

if (-not (Test-Path $Bat)) { throw "未找到 $Bat" }

# 优先用环境变量指定的 Python，其次 python
$py = if ($env:PYTHON_EXE) { $env:PYTHON_EXE } else { 'python' }

$action = New-ScheduledTaskAction `
    -Execute "$Bat" `
    -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 10)

Write-Host "注册计划任务: $TaskName  每日 $Time  数据源 $Source" -ForegroundColor Cyan

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "全市场 A 股日K 增量更新 -> $Root\data\kline-full.db" `
    -Force | Out-Null

Write-Host "完成。可用以下命令验证 / 立即试跑 / 卸载：" -ForegroundColor Green
Write-Host "  Get-ScheduledTask -TaskName $TaskName"
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
Write-Host "  Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
Write-Host ""
Write-Host "日志: $Root\data\kline-full.log" -ForegroundColor Gray
