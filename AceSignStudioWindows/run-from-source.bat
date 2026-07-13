@echo off
REM Run Ace Sign Studio directly from source (no packaging) — handy for testing.
setlocal
cd /d "%~dp0"
where py >nul 2>nul && (set "PY=py -3") || (set "PY=python")
%PY% -m pip install -r requirements.txt
%PY% main.py
pause
