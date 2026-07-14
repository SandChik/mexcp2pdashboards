@echo off
title MEXC Dashboard - Install
echo ====================================
echo  MEXC P2P Dashboard - Install
echo ====================================
echo.

:: Get the directory of this batch file (handles spaces in path)
set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"

echo Root: %ROOT%
echo.

:: Check Node.js
node -v >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js tidak ditemukan!
    echo Download dari: https://nodejs.org ^(pilih LTS^)
    pause
    exit /b 1
)
echo Node.js: OK
node -v

echo.
echo [1/2] Installing backend...
cd /d "%BACKEND%"
if errorlevel 1 (
    echo ERROR: Folder backend tidak ditemukan
    pause
    exit /b 1
)
call npm install
if errorlevel 1 (
    echo ERROR: Backend install gagal
    pause
    exit /b 1
)
echo Backend: OK

echo.
echo [2/2] Installing frontend...
cd /d "%FRONTEND%"
if errorlevel 1 (
    echo ERROR: Folder frontend tidak ditemukan
    pause
    exit /b 1
)
call npm install
if errorlevel 1 (
    echo ERROR: Frontend install gagal
    pause
    exit /b 1
)
echo Frontend: OK

echo.
echo ====================================
echo  SELESAI! Jalankan START.bat
echo ====================================
pause
