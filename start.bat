@echo off
echo ========================================
echo Crypto Levels Bhushan - Starting...
echo ========================================
echo.

REM Check if setup has been run
if not exist "backend\venv" (
    echo ERROR: Virtual environment not found!
    echo Please run "setup.bat" first to install dependencies.
    echo.
    pause
    exit /b 1
)

if not exist "frontend\node_modules" (
    echo ERROR: Node modules not found!
    echo Please run "setup.bat" first to install dependencies.
    echo.
    pause
    exit /b 1
)

echo Starting Backend and Frontend...
echo.
echo Backend will run on: http://localhost:8000
echo Frontend will open at: http://localhost:3000
echo.
echo Press Ctrl+C in this window to stop both servers.
echo ========================================
echo.

REM Start backend in new window with venv activated
start "Crypto Levels - Backend" cmd /k "cd backend && venv\Scripts\activate.bat && python main.py"

REM Wait 3 seconds for backend to start
timeout /t 3 /nobreak >nul

REM Start frontend in new window
start "Crypto Levels - Frontend" cmd /k "cd frontend && npm start"

echo.
echo ========================================
echo Both servers are starting...
echo ========================================
echo.
echo Backend Terminal: Check the "Crypto Levels - Backend" window
echo Frontend Terminal: Check the "Crypto Levels - Frontend" window
echo.
echo The browser will open automatically at http://localhost:3000
echo.
echo To stop the servers:
echo 1. Close both terminal windows, OR
echo 2. Press Ctrl+C in each terminal window
echo ========================================
echo.
echo This window can be closed safely.
pause
