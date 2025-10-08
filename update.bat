@echo off
chcp 65001 >nul
title VideoSOS - Обновление

echo ========================================
echo   VideoSOS - Обновление из Git
echo ========================================
echo.

REM Проверка наличия Git
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo ОШИБКА: Git не найден!
    echo.
    echo Пожалуйста, установите Git с https://git-scm.com/
    echo.
    pause
    exit /b 1
)

REM Проверка наличия Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ОШИБКА: Node.js не найден!
    echo.
    echo Пожалуйста, установите Node.js с https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo Шаг 1/4: Получение последних изменений...
echo.

REM Проверка наличия .git папки
if exist ".git" (
    echo Обновление через Git...
    echo.
    git pull
    if errorlevel 1 (
        echo.
        echo ОШИБКА: Не удалось выполнить git pull
        echo Возможно, у вас есть несохраненные изменения.
        echo.
        pause
        exit /b 1
    )
) else (
    echo Загрузка последней версии с GitHub...
    echo.
    
    REM Скачивание архива
    curl -L -o temp_update.zip https://github.com/timoncool/videosos/archive/refs/heads/main.zip
    if errorlevel 1 (
        echo.
        echo ОШИБКА: Не удалось скачать обновление
        echo Проверьте подключение к интернету.
        echo.
        pause
        exit /b 1
    )
    
    REM Распаковка архива
    powershell -command "Expand-Archive -Path temp_update.zip -DestinationPath temp_update -Force"
    if errorlevel 1 (
        echo.
        echo ОШИБКА: Не удалось распаковать архив
        del temp_update.zip
        pause
        exit /b 1
    )
    
    REM Копирование файлов
    xcopy /E /Y /I temp_update\videosos-main\* .
    if errorlevel 1 (
        echo.
        echo ОШИБКА: Не удалось скопировать файлы
        del temp_update.zip
        rmdir /S /Q temp_update
        pause
        exit /b 1
    )
    
    REM Очистка временных файлов
    del temp_update.zip
    rmdir /S /Q temp_update
    echo ✓ Обновление загружено успешно
)

echo.
echo Шаг 2/4: Обновление зависимостей...
echo.
call npm install
if errorlevel 1 (
    echo.
    echo ОШИБКА: Не удалось обновить зависимости
    pause
    exit /b 1
)

echo.
echo Шаг 3/4: Очистка старой сборки...
echo.
if exist ".next" (
    rmdir /S /Q ".next"
    echo ✓ Старая сборка удалена
)

echo.
echo Шаг 4/4: Создание новой production сборки...
echo.
call npm run build
if errorlevel 1 (
    echo.
    echo ОШИБКА: Не удалось создать новую сборку
    pause
    exit /b 1
)

echo.
echo ========================================
echo ✓ Обновление завершено успешно!
echo ========================================
echo.
echo Теперь вы можете запустить обновленную версию
echo используя start.bat
echo.
pause
