@echo off
title OMNIPOTENT
echo.
echo ========================================
echo   OMNIPOTENT - Starting...
echo ========================================
echo.

cd /d "%~dp0"

:: Check if Electron is installed
where electron >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Starting Electron app...
    npm run dev:electron
) else (
    echo Electron not found, starting web mode...
    echo Run 'npm install' to install dependencies for Electron mode.
    echo.
    npm run dev
)

pause
