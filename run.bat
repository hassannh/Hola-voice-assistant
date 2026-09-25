@echo off
cd /d "%~dp0"
if exist "venv\Scripts\python.exe" (
  "venv\Scripts\python.exe" assistant.py %*
) else (
  echo Create the venv first: python -m venv venv ^& venv\Scripts\pip install -r requirements.txt
  exit /b 1
)
