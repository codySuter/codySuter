@echo off
REM Builds EpicorInvoiceConverter.exe on Windows.
REM Requires Python 3.9+ installed from https://www.python.org (check "Add to PATH").
cd /d "%~dp0"

where py >nul 2>nul && (set PY=py) || (set PY=python)
%PY% -m venv build-venv || goto :error
call build-venv\Scripts\activate.bat || goto :error
pip install --upgrade pip
pip install -r requirements.txt pyinstaller || goto :error
pyinstaller --onefile --windowed --name EpicorInvoiceConverter app.py || goto :error

echo.
echo Build complete: dist\EpicorInvoiceConverter.exe
pause
exit /b 0

:error
echo.
echo Build FAILED - see messages above.
pause
exit /b 1
