@echo off
chcp 65001 >nul
setlocal

REM 全市场日K 全量构建（通达信本地源）
REM 用法：双击运行，或 run_full.bat [额外参数]

set "TOOLS_DIR=%~dp0"
set "ROOT=%TOOLS_DIR%.."
set "PY=%PYTHON_EXE%"
if "%PY%"=="" set "PY=python"

echo ============================================
echo  全市场日K 全量构建 - 数据源: 通达信本地
echo ============================================

REM 先检查通达信数据是否就绪
"%PY%" "%TOOLS_DIR%kline_full.py" --check-tdx
if errorlevel 1 (
    echo.
    echo [提示] 通达信历史数据尚未就绪，仍可继续但只能抓到部分年份。
    choice /C YN /M "是否继续"
    if errorlevel 2 goto :eof
)

"%PY%" "%TOOLS_DIR%kline_full.py" --source tdx --workers 24 %*
if errorlevel 1 (
    echo.
    echo [失败] 请查看上方错误信息
    pause
    exit /b 1
)

echo.
echo 完成。执行 run_stats.bat 或 python tools/kline_full.py --stats 查看统计
pause
