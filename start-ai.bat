@echo off
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 ai_server.py
  goto :eof
)

where python >nul 2>nul
if %errorlevel% equ 0 (
  python ai_server.py
  goto :eof
)

echo 未找到 Python，请先安装 Python 3.12 或更高版本。
pause

