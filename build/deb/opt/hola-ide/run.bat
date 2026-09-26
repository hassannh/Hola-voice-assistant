@echo off
cd /d "%~dp0"
if exist venv\Scripts\python.exe (
  venv\Scripts\python.exe ide.py %*
  exit /b %errorlevel%
)
echo Create the venv first: python -m venv venv and install requirements.txt
exit /b 1
