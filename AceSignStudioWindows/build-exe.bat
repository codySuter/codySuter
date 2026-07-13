@echo off
REM ============================================================
REM  Build Ace Sign Studio into a double-clickable Windows .exe
REM  Just double-click this file. First run takes a few minutes.
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo === Ace Sign Studio - building the Windows app ===
echo.

REM Find Python (py launcher preferred, else python on PATH)
where py >nul 2>nul
if %errorlevel%==0 (
    set "PY=py -3"
) else (
    where python >nul 2>nul
    if %errorlevel%==0 (
        set "PY=python"
    ) else (
        echo ERROR: Python was not found.
        echo Install Python 3.10 or newer from https://www.python.org/downloads/
        echo Be sure to check "Add python.exe to PATH" during install, then run this again.
        pause
        exit /b 1
    )
)

echo Using Python: %PY%
echo Creating a build environment...
%PY% -m venv build-venv
if errorlevel 1 ( echo ERROR: could not create venv & pause & exit /b 1 )

call build-venv\Scripts\activate.bat

echo Installing dependencies (requests, Pillow, reportlab, selenium, pywin32, pyinstaller)...
python -m pip install --upgrade pip >nul
python -m pip install -r requirements.txt
if errorlevel 1 ( echo ERROR: dependency install failed & pause & exit /b 1 )

echo Packaging the app...
pyinstaller --noconfirm ace_sign_studio.spec
if errorlevel 1 ( echo ERROR: build failed & pause & exit /b 1 )

echo.
echo ============================================================
echo  DONE.  Your app is here:
echo     %cd%\dist\AceSignStudio.exe
echo.
echo  Double-click AceSignStudio.exe to run it. You can copy that
echo  single file to any Windows PC (Desktop, a USB stick, etc.).
echo ============================================================
echo.
pause
