@echo off
chcp 65001 >nul
title VideoSOS - Остановка

echo ========================================
echo   VideoSOS - Остановка сервера
echo ========================================
echo.

echo Остановка всех процессов Node.js...
taskkill /F /IM node.exe /T >nul 2>&1

if %errorlevel% equ 0 (
    echo ✓ VideoSOS успешно остановлен
) else (
    echo ℹ Процессы Node.js не найдены или уже остановлены
)

echo.
echo ========================================
timeout /t 2 >nul
