@echo off
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found!
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
)

:: Start server in background (hidden window, survives parent close)
:: Using VBScript to launch completely hidden
cscript //nologo "%~dp0start_hidden.vbs"

echo.
echo   Server is running at http://localhost:3001
echo   Opening browser...
echo.
echo   To STOP the server, double-click "stop.bat"
echo.
timeout /t 3 >nul

:: Open browser
start "" http://localhost:3001

exit
