@echo off
title Aether Workshop Launcher
cls
echo =====================================================================
echo   Aether Workshop: Dynamic Persona Studio Launcher
echo =====================================================================
echo.
echo  Starting backend server with local network access...
echo.

:: Try to detect the primary local IPv4 address
set LOCAL_IP=
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi*', 'Ethernet*' | Select-Object -First 1).IPAddress"`) do set LOCAL_IP=%%i

echo  [Connection Info]
echo  --------------------------------------------------
echo  Local Access:   http://localhost:8000
if not "%LOCAL_IP%"=="" (
    echo  Network Access: http://%LOCAL_IP%:8000
) else (
    echo  Network Access: (No active Wi-Fi/Ethernet adapter detected)
)
echo  --------------------------------------------------
echo.
echo  * Keeping this window open will keep the server running.
echo  * Press Ctrl+C in this window to stop the server.
echo.

:: Wait 2 seconds in a background process, then open the browser automatically
start "" cmd /c "timeout /t 2 >nul && start http://localhost:8000"

:: Start Uvicorn server bound to all interfaces on port 8000.
:: Prefer the local virtual environment created by setup.bat; fall back to a
:: globally installed uvicorn if setup was skipped.
if exist ".venv\Scripts\uvicorn.exe" (
    ".venv\Scripts\uvicorn.exe" main:app --host 0.0.0.0 --port 8000
) else (
    echo  [Notice] .venv not found - run setup.bat first for an isolated install.
    echo.
    uvicorn main:app --host 0.0.0.0 --port 8000
)

echo.
echo Server has stopped.
pause
