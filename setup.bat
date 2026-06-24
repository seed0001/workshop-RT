@echo off
title Aether Workshop - Setup
cls
echo =====================================================================
echo   Aether Workshop : One-Time Setup
echo =====================================================================
echo.
echo  This will create a local Python environment and install everything
echo  the workshop needs. Run it once. After it finishes, use
echo  run_workshop.bat to start the app.
echo.

REM --- 1. Check Python is installed ---
where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python was not found on your PATH.
    echo.
    echo  Install Python 3.10 or newer from:
    echo      https://www.python.org/downloads/
    echo  IMPORTANT: tick "Add Python to PATH" in the installer, then
    echo  re-run this setup.
    echo.
    pause
    exit /b 1
)
echo [OK] Found Python:
python --version
echo.

REM --- 2. Create the virtual environment (.venv) ---
if exist ".venv\Scripts\python.exe" (
    echo [OK] Virtual environment already exists, reusing it.
) else (
    echo Creating virtual environment in .venv ...
    python -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Could not create the virtual environment.
        pause
        exit /b 1
    )
)
echo.

REM --- 3. Install Python dependencies into the venv ---
echo Installing Python dependencies ^(this can take a minute^)...
call ".venv\Scripts\python.exe" -m pip install --upgrade pip
call ".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Dependency installation failed. Check your internet connection.
    pause
    exit /b 1
)
echo.
echo [OK] Python dependencies installed.
echo.

REM --- 4. Check for Ollama (the local AI engine) ---
where ollama >nul 2>nul
if errorlevel 1 (
    echo [WARNING] Ollama was not found.
    echo  The workshop needs Ollama to run the local AI models.
    echo  Download and install it from:
    echo      https://ollama.com/download
    echo  Then pull a model, for example:
    echo      ollama pull llama3.2
) else (
    echo [OK] Found Ollama:
    ollama --version
    echo  If you have not pulled a model yet, run:
    echo      ollama pull llama3.2
)
echo.
echo =====================================================================
echo   Setup complete!
echo   Make sure Ollama is running, then double-click run_workshop.bat
echo =====================================================================
echo.
pause
