@echo off
echo ========================================
echo Crypto Levels Bhushan - Initial Setup
echo ========================================
echo.

REM Setup Backend
echo [1/3] Setting up Backend (Python Virtual Environment)...
cd backend

REM Create virtual environment if it doesn't exist
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
    echo Virtual environment created!
) else (
    echo Virtual environment already exists.
)

REM Activate venv and install dependencies
echo Installing Python dependencies...
call venv\Scripts\activate.bat
pip install -r requirements.txt
call venv\Scripts\deactivate.bat
echo Backend setup complete!
echo.

cd ..

REM Setup Frontend
echo [2/3] Setting up Frontend (Node.js)...
cd frontend

REM Install npm dependencies
if not exist "node_modules" (
    echo Installing Node.js dependencies...
    call npm install
    echo Frontend setup complete!
) else (
    echo Node modules already installed.
)
echo.

cd ..

echo [3/3] Setup Complete!
echo.
echo ========================================
echo Next Steps:
echo ========================================
echo 1. Run "start.bat" to launch the application
echo 2. Backend will run on: http://localhost:8000
echo 3. Frontend will open at: http://localhost:3000
echo ========================================
echo.
pause
