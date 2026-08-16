@echo off
chcp 65001 >nul
title Booru Media Explorer

echo ======================================================
echo   Booru Media Explorer
echo ======================================================
echo.

if not exist node_modules (
    echo [*] Installing dependencies, please wait...
    call npm install
)

echo [*] Starting local server...
node server.js

pause
