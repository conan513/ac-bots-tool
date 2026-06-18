@echo off
title AzerothCore Builder Dashboard
cd /d "%~dp0"

echo ===================================================
echo   AzerothCore & mod-playerbots Build Dashboard
echo ===================================================
echo.

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: A Node.js nincs telepitve! Kerlek telepisd a nodejs.org-rol.
    pause
    exit /b
)

:: Install root dependencies if not present
if not exist node_modules (
    echo [1/3] Rendszer fuggosegek telepitse...
    call npm install
    echo.
) else (
    echo [1/3] Rendszer fuggosegek mar telepitve vannak.
)

:: Install frontend dependencies if not present
if not exist frontend\node_modules (
    echo [2/3] UI fuggosegek telepitse...
    cd frontend
    call npm install
    cd ..
    echo.
) else (
    echo [2/3] UI fuggosegek mar telepitve vannak.
)

:: Build frontend if dist doesn't exist
if not exist frontend\dist (
    echo [3/3] UI forraskod fordítása...
    call npm run build-frontend
    echo.
) else (
    echo [3/3] UI mar le van forditva.
)

echo.
echo Inditas folyamatban...
echo A bongeszo megnyilik a http://localhost:3000 cimen.
echo.
call npm start
pause
