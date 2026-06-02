@echo off
REM Respaldo manual de la base de datos (doble clic).
cd /d "%~dp0"
echo Creando respaldo de la base de datos...
echo.
node src\backup.js
echo.
pause
