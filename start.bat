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
    echo ERROR: Node.js is not installed! Please install it from nodejs.org.
    pause
    exit /b
)

:: Install root dependencies if not present
if not exist node_modules (
    echo [1/3] Installing system dependencies...
    call npm install
    echo.
) else (
    echo [1/3] System dependencies are already installed.
)

:: Install frontend dependencies if not present
if not exist frontend\node_modules (
    echo [2/3] Installing UI dependencies...
    cd frontend
    call npm install
    cd ..
    echo.
) else (
    echo [2/3] UI dependencies are already installed.
)

:: Always build frontend on startup
echo [3/3] Building UI source code...
call npm run build-frontend
echo.

echo.
echo Launching...
echo The browser will open at http://localhost:3000
echo.
call npm start
pause
