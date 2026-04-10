@echo off
echo Stopping server...

:: Kill by PID file if exists
if exist ".server.pid" (
    for /f %%p in (.server.pid) do (
        taskkill /PID %%p /F >nul 2>&1
        del .server.pid >nul 2>&1
    )
)

:: Fallback: kill any node process running app.js
for /f "tokens=2" %%a in ('wmic process where "commandline like '%%app.js%%' and name='node.exe'" get processid /value 2^>nul ^| find "="') do (
    taskkill /PID %%a /F >nul 2>&1
)

:: Also kill any launcher
for /f "tokens=2" %%a in ('wmic process where "commandline like '%%launcher.js%%' and name='node.exe'" get processid /value 2^>nul ^| find "="') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo Done. Server stopped.
timeout /t 2 >nul
