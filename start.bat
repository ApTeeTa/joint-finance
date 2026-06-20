@echo off
cd /d "%~dp0"
echo.
echo  Joint Finance - локальный сервер
echo  Откройте в браузере: http://127.0.0.1:8080/
echo  Закройте это окно, чтобы остановить сервер.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
