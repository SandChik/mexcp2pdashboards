@echo off
title MEXC P2P Dashboard
echo Starting MEXC P2P Dashboard...
echo.

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"

:: Check Node.js
node -v >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js tidak ditemukan!
    echo Install dulu dari https://nodejs.org ^(pilih LTS^), lalu jalankan lagi.
    pause
    exit /b 1
)

:: Auto-install backend if missing
if not exist "%BACKEND%\node_modules" (
    echo Backend belum terpasang - menginstall otomatis...
    cd /d "%BACKEND%"
    if errorlevel 1 ( echo ERROR: folder backend tidak ditemukan & pause & exit /b 1 )
    call npm install
    if errorlevel 1 (
        echo.
        echo ERROR: install backend GAGAL. Biasanya karena internet/antivirus memblokir npm.
        echo Coba: buka Command Prompt di folder backend, jalankan: npm install
        pause
        exit /b 1
    )
    echo Backend: OK
)

:: Auto-install frontend if missing
if not exist "%FRONTEND%\node_modules" (
    echo Frontend belum terpasang - menginstall otomatis...
    cd /d "%FRONTEND%"
    if errorlevel 1 ( echo ERROR: folder frontend tidak ditemukan & pause & exit /b 1 )
    call npm install
    if errorlevel 1 (
        echo.
        echo ERROR: install frontend GAGAL.
        echo Coba: buka Command Prompt di folder frontend, jalankan: npm install
        pause
        exit /b 1
    )
    echo Frontend: OK
)

echo.
echo [1/2] Starting Backend (port 3001)...
start "MEXC Backend" cmd /k "cd /d "%BACKEND%" && npm start"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Frontend (port 3000)...
start "MEXC Frontend" cmd /k "cd /d "%FRONTEND%" && npm run dev"

timeout /t 5 /nobreak >nul

echo Opening browser...
start http://localhost:3000

echo.
echo Dashboard berjalan di: http://localhost:3000
echo Tutup dua jendela terminal untuk menghentikan.
pause
