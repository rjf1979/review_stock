@echo off
chcp 65001 >nul
setlocal

REM 每日增量更新（收盘后运行，自动判断已有数据只抓新增）

set "TOOLS_DIR=%~dp0"
set "ROOT=%TOOLS_DIR%.."
set "PY=%PYTHON_EXE%"
if "%PY%"=="" set "PY=python"
set "LOG=%ROOT%\data\kline-full.log"

echo ============================================ >> "%LOG%"
echo [%date% %time%] 开始每日增量更新 >> "%LOG%"

"%PY%" "%TOOLS_DIR%kline_full.py" --source tdx --workers 24 --pending-only >> "%LOG%" 2>&1

if errorlevel 1 (
    echo [%date% %time%] 结束（存在失败项，见日志）>> "%LOG%"
) else (
    echo [%date% %time%] 结束（成功）>> "%LOG%"
)

endlocal
